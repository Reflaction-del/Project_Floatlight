// ============================================================
// 文章抽取（Phase 1a · 功能1）
// ------------------------------------------------------------
// 给定一段 txt/md 正文，调用 OpenAI 兼容模型识别其中的
// 世界观实体与实体间关系，返回结构化结果。结果由调用方
// 转为「提案」进入统一提案队列（不直接落库）。
// ============================================================

import { chatOnce, chatWithTools, getCurrentModel, modelSupportsTools } from '../../utils/ai';
import { retrieveExistingForExtraction, entityBrief } from '../../utils/worldContext';
import { makeWorldTools } from '../../utils/aiTools';
import type { EntityType, RelationType, WikiEntity, WikiRelation } from '../../types';
import type { WorldData } from '../../store/worldStore';
import type { AIModel } from '../../store/aiStore';

export interface ExtractedEntity {
  name: string;
  type: EntityType;
  note?: string;
  fields?: { label: string; value: string }[];
  tags?: string[];
  /** 若与已有实体为同一事物，模型回填其 id（用于去重/合并，避免大世界下重复建实体） */
  existingId?: string;
}

export interface ExtractedRelation {
  /** 源实体名称（解析时再映射到 id） */
  source: string;
  /** 目标实体名称 */
  target: string;
  type: RelationType;
  label?: string;
}

export interface ExtractResult {
  entities: ExtractedEntity[];
  relations: ExtractedRelation[];
}

const ENTITY_TYPES: EntityType[] = ['character', 'faction', 'location', 'event', 'rule'];
const RELATION_TYPES: RelationType[] = ['belongs', 'enemy', 'occurs', 'causal', 'kin', 'custom'];

const TYPE_CN: Record<EntityType, string> = {
  character: '角色', faction: '势力', location: '地点', event: '事件', rule: '规则',
};
const REL_CN: Record<RelationType, string> = {
  belongs: '隶属', enemy: '敌对', occurs: '发生于', causal: '因果', kin: '亲缘', custom: '自定义',
};

function normalizeType(raw: unknown): EntityType {
  if (typeof raw === 'string') {
    const r = raw.trim().toLowerCase();
    if ((ENTITY_TYPES as string[]).includes(r)) return r as EntityType;
    // 容错：中文名
    const hit = ENTITY_TYPES.find((t) => TYPE_CN[t] === raw.trim());
    if (hit) return hit;
  }
  return 'character';
}

function normalizeRel(raw: unknown): RelationType {
  if (typeof raw === 'string') {
    const r = raw.trim().toLowerCase();
    if ((RELATION_TYPES as string[]).includes(r)) return r as RelationType;
    const hit = RELATION_TYPES.find((t) => REL_CN[t] === raw.trim());
    if (hit) return hit;
  }
  return 'custom';
}

function buildPrompt(text: string, worldName: string, existingBlock?: string): string {
  const existingSection = existingBlock
    ? [
        `【已有实体（去重参考）】下面是当前世界已存在的实体。若文中实体与其中之一为同一事物，请直接在对应实体的 "existingId" 字段填其 id，不要新建重复实体；否则省略 existingId。`,
        existingBlock,
        '',
      ].join('\n')
    : '';
  return [
    `你是一个世界观构建助手。请从下面的文章中抽取「实体」与「实体之间的关系」，用于一个名为《${worldName}》的虚构世界。`,
    '',
    `实体类型（type 字段必须严格使用以下英文 key）：`,
    `character=角色, faction=势力, location=地点, event=事件, rule=规则。`,
    `关系类型（type 字段必须严格使用以下英文 key）：`,
    `belongs=隶属, enemy=敌对, occurs=发生于, causal=因果, kin=亲缘, custom=自定义。`,
    '',
    `要求：`,
    `1. 只抽取文中明确出现或有强隐含的实体与关系，不要臆造。`,
    `2. 实体 name 用文中出现的名字；可附带 note（一句话设定）、fields（若干 {label,value} 结构化字段）、tags（字符串数组）。`,
    `3. 关系的 source / target 必须是文中实体的名字（与 entities 中的 name 完全一致），type 用上述英文 key，label 为可选的中文关系说明。`,
    `4. 若某实体与下方「已有实体（去重参考）」中的某条为同一事物，务必把 existingId 设为该条 id，不要重复创建。`,
    `5. 只输出一个 JSON 对象，不要任何解释、不要 markdown 代码围栏。结构：`,
    `{"entities":[{"name":"","type":"character","existingId":"","note":"","fields":[{"label":"","value":""}],"tags":[]}],"relations":[{"source":"","target":"","type":"belongs","label":""}]}`,
    '',
    existingSection,
    `待分析文章：`,
    '<<<ARTICLE>>>',
    text,
    '<<<END>>>',
  ].join('\n');
}

/** 解析模型返回的 JSON（兼容 ```json 代码围栏） */
function parseModelJSON(raw: string): any {
  let s = raw.trim();
  // 去掉可能的 ```json ... ``` 或 ``` ... ```
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // 截取第一个 { 到最后一个 }
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  return JSON.parse(s);
}

/** 把模型 JSON 映射为结构化结果（两条路径共用） */
function mapExtractData(data: any): ExtractResult {
  const entities: ExtractedEntity[] = Array.isArray(data?.entities)
    ? data.entities
        .map((e: any): ExtractedEntity | null => {
          const name = typeof e?.name === 'string' ? e.name.trim() : '';
          if (!name) return null;
          return {
            name,
            type: normalizeType(e.type),
            note: typeof e?.note === 'string' ? e.note : undefined,
            existingId: typeof e?.existingId === 'string' && e.existingId.trim() ? e.existingId.trim() : undefined,
            fields: Array.isArray(e?.fields)
              ? e.fields
                  .filter((f: any) => f && typeof f.label === 'string' && typeof f.value === 'string')
                  .map((f: any) => ({ label: f.label, value: f.value }))
              : undefined,
            tags: Array.isArray(e?.tags) ? e.tags.filter((t: any) => typeof t === 'string') : undefined,
          };
        })
        .filter((x: ExtractedEntity | null): x is ExtractedEntity => x !== null)
    : [];

  const relations: ExtractedRelation[] = Array.isArray(data?.relations)
    ? data.relations
        .map((r: any): ExtractedRelation | null => {
          const source = typeof r?.source === 'string' ? r.source.trim() : '';
          const target = typeof r?.target === 'string' ? r.target.trim() : '';
          if (!source || !target) return null;
          return {
            source,
            target,
            type: normalizeRel(r.type),
            label: typeof r?.label === 'string' ? r.label : undefined,
          };
        })
        .filter((x: ExtractedRelation | null): x is ExtractedRelation => x !== null)
    : [];

  return { entities, relations };
}

/**
 * 工具调用模式：模型可先调用 search_entities / get_entity 按需核对已有实体，
 * 再把 existingId 回填到结果，避免把候选库灌入 prompt（上下文始终极小）。
 */
async function extractWithTools(
  model: AIModel,
  text: string,
  worldName: string,
  world: Pick<WorldData, 'entities' | 'relations'>,
  signal: AbortSignal | undefined,
  maxTokens: number,
): Promise<ExtractResult> {
  const toolsCtx = makeWorldTools(world, { topK: 10 });
  const system =
    `你是一个世界观构建助手。请从给定文章中抽取「实体」与「实体之间的关系」，用于虚构世界《${worldName}》。\n` +
    `实体类型（type 字段必须严格使用以下英文 key）：\n` +
    `character=角色, faction=势力, location=地点, event=事件, rule=规则。\n` +
    `关系类型（type 字段必须严格使用以下英文 key）：\n` +
    `belongs=隶属, enemy=敌对, occurs=发生于, causal=因果, kin=亲缘, custom=自定义。\n` +
    `要求：\n` +
    `1. 只抽取文中明确出现或有强隐含的实体与关系，不要臆造。\n` +
    `2. 实体 name 用文中出现的名字；可附带 note（一句话设定）、fields（若干 {label,value} 结构化字段）、tags（字符串数组）。\n` +
    `3. 关系的 source / target 必须是文中实体的名字（与 entities 中的 name 完全一致），type 用上述英文 key，label 为可选的中文关系说明。\n` +
    `4. 若文中实体与「已有实体」中的某条为同一事物，请先调用 search_entities 确认，再把该条 id 填到 existingId 字段，不要重复创建；否则省略 existingId。\n` +
    `5. 完成抽取后，只输出一个 JSON 对象，不要任何解释、不要 markdown 代码围栏。结构：\n` +
    `{"entities":[{"name":"","type":"character","existingId":"","note":"","fields":[{"label":"","value":""}],"tags":[]}],"relations":[{"source":"","target":"","type":"belongs","label":""}]}`;
  const user = `待分析文章：\n<<<ARTICLE>>>\n${text}\n<<<END>>>`;
  const raw = (
    await chatWithTools(
      model,
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      toolsCtx,
      { signal, feature: 'article-extract', maxTokens },
    )
  ).trim();
  if (!raw) throw new Error('模型返回为空，请重试。');
  let data: any;
  try {
    data = parseModelJSON(raw);
  } catch {
    throw new Error('模型返回无法解析为 JSON，请重试或换用更强的模型。');
  }
  return mapExtractData(data);
}

/**
 * 从文章文本抽取实体与关系。
 * @param text 文章正文
 * @param worldName 当前世界名（用于提示模型语境）
 * @param signal 可中断
 * @param maxTokens 输出 token 上限
 * @param world 可选：当前世界已有实体/关系。若模型支持工具调用，则走「按需检索」模式；
 *              否则走「词法召回 topK 注入」模式。两种模式都从源头避免整库灌入。
 */
export async function extractFromArticle(
  text: string,
  worldName: string,
  signal?: AbortSignal,
  maxTokens = 4096,
  world?: Pick<WorldData, 'entities' | 'relations'>,
): Promise<ExtractResult> {
  const model = getCurrentModel();
  if (!model) {
    throw new Error('未配置文本模型：请打开 设置 → 大模型接入 添加（endpoint / api_key / model）。');
  }
  const truncated = text.length > 12000 ? text.slice(0, 12000) + '\n…（已截断前 12000 字）' : text;

  // 工具调用模式：模型按需拉取上下文，prompt 极小，最适配大世界观
  if (world && modelSupportsTools(model)) {
    return extractWithTools(model, truncated, worldName, world, signal, maxTokens);
  }

  // 词法模式：只召回与正文最相关的已有实体（topK），从源头避免整库注入撑爆上下文
  let existingBlock: string | undefined;
  if (world && (world.entities ?? []).length > 0) {
    const retrieved = retrieveExistingForExtraction(world, truncated, 40);
    if (retrieved.length > 0) {
      const byId = new Map<string, WikiEntity>((world.entities ?? []).map((e) => [e.id, e]));
      existingBlock = retrieved.map((r) => entityBrief(r.entity, r.related, byId)).join('\n\n');
    }
  }
  const prompt = buildPrompt(truncated, worldName, existingBlock);
  const raw = (await chatOnce(model, [{ role: 'user', content: prompt }], { signal, feature: 'article-extract', maxTokens })).trim();
  if (!raw) throw new Error('模型返回为空，请重试。');

  let data: any;
  try {
    data = parseModelJSON(raw);
  } catch {
    throw new Error('模型返回无法解析为 JSON，请重试或换用更强的模型。');
  }
  return mapExtractData(data);
}
