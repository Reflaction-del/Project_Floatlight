// ============================================================
// 实体关联引擎（Phase 1b · 功能3）
// ------------------------------------------------------------
// 给定文本与实体库，识别文中出现的实体名称并将其与实体库关联：
//  - exact 精确匹配：名称完全一致即视为已关联；
//  - fuzzy 模糊匹配：编辑距离 / 包含关系的近似名视为同一实体的别名；
//  - llm   大模型对应：由模型判断每个提及指代哪个库内实体（或判定为新实体）。
// 输出为候选关联，由调用方转为「提案」进入统一提案队列。
// ============================================================

import { chatOnce, chatWithTools, getCurrentModel, modelSupportsTools } from '../../utils/ai';
import { useWorldStore } from '../../store/worldStore';
import { pickEntityCandidates } from '../../utils/worldContext';
import { makeWorldTools } from '../../utils/aiTools';
import type { WikiEntity, WikiRelation, EntityType } from '../../types';
import type { AIModel } from '../../store/aiStore';

export type LinkMode = 'exact' | 'fuzzy' | 'llm';

export interface LinkCandidate {
  /** 文中出现的名称（提及） */
  mention: string;
  /** 关联到的库内实体 id（alias 模式） */
  targetId?: string;
  targetName?: string;
  /** alias = 作为别名加入已有实体；new = 新建实体 */
  action: 'alias' | 'new';
  /** new 模式下的实体类型 */
  newType?: EntityType;
  reason?: string;
}

const ENTITY_TYPES: EntityType[] = ['character', 'faction', 'location', 'event', 'rule'];
const TYPE_CN: Record<EntityType, string> = {
  character: '角色', faction: '势力', location: '地点', event: '事件', rule: '规则',
};

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, '');
}

function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const d: number[][] = Array.from({ length: m + 1 }, () => [0, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }
  return d[m][n];
}

/** 从文本切出候选名称片段（含中文 2~6 字滑窗） */
function tokenize(text: string): string[] {
  const segs = text.split(/[\s，。、！？；：“”‘’（）()\[\]【】“”…—\-—,.;:!?/]/).filter((s) => s.trim().length > 0);
  const out = new Set<string>();
  for (const s of segs) {
    if (/[一-鿿]/.test(s)) {
      const maxLen = Math.min(6, s.length);
      for (let L = 2; L <= maxLen; L++) {
        for (let i = 0; i + L <= s.length; i++) out.add(s.slice(i, i + L));
      }
    } else if (s.length >= 2) {
      out.add(s);
    }
  }
  return [...out];
}

/** 确定性匹配（exact / fuzzy），不调用模型 */
function linkDeterministic(text: string, entities: WikiEntity[], mode: 'exact' | 'fuzzy'): LinkCandidate[] {
  const spans = tokenize(text);
  const seen = new Set<string>(); // 去重 mention+target
  const result: LinkCandidate[] = [];

  for (const ent of entities) {
    const nameN = norm(ent.name);
    // 精确匹配：文中出现完整实体名
    const exactHit = spans.some((sp) => norm(sp) === nameN);
    if (mode === 'exact') {
      if (exactHit) {
        const key = ent.name + '|' + ent.id;
        if (!seen.has(key)) { seen.add(key); /* 已关联，无需提案 */ }
      }
      continue;
    }
    // fuzzy：在候选片段里找与实体名近似（编辑距离≤2 或互相包含）的变体
    let best: { span: string; dist: number } | null = null;
    for (const sp of spans) {
      const sn = norm(sp);
      if (sn === nameN) continue; // 精确名本身不算别名
      if (sn.length < 2) continue;
      let dist = lev(sn, nameN);
      if (sn.includes(nameN) || nameN.includes(sn)) dist = Math.min(dist, 1);
      if (dist <= 2 && (!best || dist < best.dist)) best = { span: sp, dist };
    }
    if (best) {
      const key = best.span + '|' + ent.id;
      if (seen.has(key)) continue;
      seen.add(key);
      // 该别名已存在于 tags 则跳过
      if (ent.tags?.some((t) => norm(t) === norm(best!.span))) continue;
      result.push({ mention: best.span, targetId: ent.id, targetName: ent.name, action: 'alias', reason: `与「${ent.name}」近似（编辑距离 ${best.dist}）` });
    }
  }
  return result;
}

function buildLlmPrompt(text: string, candidates: WikiEntity[]): string {
  const list = candidates.length
    ? candidates.map((e) => `- id=${e.id} | ${e.name} | ${TYPE_CN[e.type]}`).join('\n')
    : '（无，文中出现的均为新实体）';
  return [
    `你是实体消歧助手。下面给出「实体库已有实体」与一段「待关联文本」。`,
    `请找出文本中出现的实体名称（提及），并判断每个提及指代库中的哪个实体；`,
    `若库中无对应实体，则标记为新建（并给出类型，用 character/faction/location/event/rule 之一）。`,
    ``,
    `实体库：`,
    list || '（空）',
    ``,
    `只输出 JSON 数组，不要解释、不要代码围栏。元素结构：`,
    `[{"mention":"文中出现的名称","entityId":"库内id 或 null（新建时为 null）","type":"新建时用的英文类型","reason":"简短理由"}]`,
    ``,
    `待关联文本：`,
    '<<<TEXT>>>',
    text,
    '<<<END>>>',
  ].join('\n');
}

function parseLlm(raw: string): any[] {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('[');
  const end = s.lastIndexOf(']');
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  return JSON.parse(s);
}

/** 把模型返回的关联数组映射为候选（两条路径共用） */
function mapLinkData(arr: any[], entities: WikiEntity[]): LinkCandidate[] {
  if (!Array.isArray(arr)) return [];
  const byId = new Map(entities.map((e) => [e.id, e]));
  const out: LinkCandidate[] = [];
  for (const item of arr) {
    const mention = typeof item?.mention === 'string' ? item.mention.trim() : '';
    if (!mention) continue;
    const eid = typeof item?.entityId === 'string' ? item.entityId : null;
    if (eid && byId.has(eid)) {
      const ent = byId.get(eid)!;
      if (norm(mention) === norm(ent.name)) continue; // 精确名本身
      if (ent.tags?.some((t) => norm(t) === norm(mention))) continue;
      out.push({ mention, targetId: ent.id, targetName: ent.name, action: 'alias', reason: item?.reason });
    } else {
      let t: EntityType = 'character';
      const rt = typeof item?.type === 'string' ? item.type.trim().toLowerCase() : '';
      if ((ENTITY_TYPES as string[]).includes(rt)) t = rt as EntityType;
      else {
        const hit = ENTITY_TYPES.find((x) => TYPE_CN[x] === (typeof item?.type === 'string' ? item.type.trim() : ''));
        if (hit) t = hit;
      }
      out.push({ mention, action: 'new', newType: t, reason: item?.reason });
    }
  }
  return out;
}

/** 工具调用模式：模型用 search_entities / get_entity 按需检索库内实体，不灌入候选列表 */
async function linkWithTools(
  text: string,
  entities: WikiEntity[],
  relations: WikiRelation[],
  model: AIModel,
  signal?: AbortSignal,
): Promise<LinkCandidate[]> {
  const toolsCtx = makeWorldTools({ entities, relations }, { topK: 20 });
  const system =
    `你是实体消歧助手。给定一段「待关联文本」，找出文本中出现的实体名称（提及），` +
    `并判断每个提及指代库中哪个已有实体（或判定为新实体）。\n` +
    `规则：\n` +
    `1. 不要假定自己知道库里有什么——先用 search_entities 检索来确认某个提及是否已有对应实体；必要时用 get_entity 看详情。\n` +
    `2. 若库中已有对应实体，输出其 id（entityId）；否则 entityId 为 null 并给出新建类型（character/faction/location/event/rule 之一）。\n` +
    `3. 只输出 JSON 数组，不要解释、不要代码围栏。元素结构：\n` +
    `[{"mention":"文中出现的名称","entityId":"库内id 或 null","type":"新建时用的英文类型","reason":"简短理由"}]`;
  const user = `待关联文本：\n<<<TEXT>>>\n${text}\n<<<END>>>`;
  const raw = (
    await chatWithTools(
      model,
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      toolsCtx,
      { signal, feature: 'entity-link' },
    )
  ).trim();
  if (!raw) throw new Error('模型返回为空，请重试。');
  let arr: any[];
  try {
    arr = parseLlm(raw);
  } catch {
    throw new Error('模型返回无法解析为 JSON，请重试或换用更强的模型。');
  }
  return mapLinkData(arr, entities);
}

/** 大模型对应模式 */
async function linkByLlm(text: string, entities: WikiEntity[], signal?: AbortSignal): Promise<LinkCandidate[]> {
  const model = getCurrentModel();
  if (!model) throw new Error('未配置文本模型：请打开 设置 → 大模型接入 添加（endpoint / api_key / model）。');
  // 工具调用模式：模型按需拉取上下文，prompt 极小，最适配大世界观
  if (modelSupportsTools(model)) {
    const world = useWorldStore.getState().worldsData[useWorldStore.getState().current];
    const relations: WikiRelation[] = world?.relations ?? [];
    return linkWithTools(text, entities, relations, model, signal);
  }
  // 词法模式：大世界观下绝不全库灌入，用共享 RAG 层预筛相关候选子集（再 token 预算裁剪）
  const world = useWorldStore.getState().worldsData[useWorldStore.getState().current];
  const relations: WikiRelation[] = world?.relations ?? [];
  const candidates = pickEntityCandidates(entities, relations, text, { topK: 80, budgetTokens: 5000 });
  const raw = (await chatOnce(model, [{ role: 'user', content: buildLlmPrompt(text, candidates) }], { signal, feature: 'entity-link' })).trim();
  if (!raw) throw new Error('模型返回为空，请重试。');
  let arr: any[];
  try {
    arr = parseLlm(raw);
  } catch {
    throw new Error('模型返回无法解析为 JSON，请重试或换用更强的模型。');
  }
  return mapLinkData(arr, entities);
}

/** 主入口：按模式执行实体关联 */
export async function linkEntities(
  text: string,
  entities: WikiEntity[],
  mode: LinkMode,
  signal?: AbortSignal,
): Promise<LinkCandidate[]> {
  if (mode === 'llm') return linkByLlm(text, entities, signal);
  return linkDeterministic(text, entities, mode);
}
