/** 世界观上下文引擎（M4 AI 约束辅助）
 * 本地无后端、无向量库，采用轻量词法检索（CJK 分词 + 重叠打分）替代 RAG：
 *   - retrieveRelevant：根据用户问题召回最相关的实体设定
 *   - buildConstraintPrompt：把召回设定注入为「必须遵循」的约束提示词
 *   - extractCited：生成后从输出中反查被提及的设定，用于来源标注
 */

import type { WikiEntity, WikiRelation, RelationType } from '../types';
import { ENTITY_LABEL, RELATION_LABEL } from '../types';
import type { WorldData } from '../store/worldStore';
import { useAIStore } from '../store/aiStore';
import { useWorldStore } from '../store/worldStore';
import { embedTexts } from './ai';
import { getCachedVectors, upsertVectors, clearMemory as clearEmbeddingIndexMemory } from './embeddingIndex';

/* —— 停用词（减少噪声，提升命中质量） —— */
const STOP = new Set([
  '的', '了', '和', '与', '在', '是', '我', '你', '他', '她', '它', '们', '有', '对', '到', '从', '把', '被',
  '这', '那', '个', '之', '等', '为', '也', '都', '就', '而', '及', '或', '一个', '这个', '那个', '可以', '怎么', '什么',
  '请', '帮', '我', '我们', '你们', '他们', '如何', '关于', '一下', '需要', '想', '要', '吧', '吗', '呢', '啊',
]);

/** CJK 友好分词：拉丁词 + 单字 + 连续中文二元组（覆盖子串匹配） */
export function tokenize(text: string): string[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const tokens: string[] = [];
  const latin = lower.match(/[a-z0-9]+/g);
  if (latin) tokens.push(...latin);
  const cjkRuns = lower.match(/[一-鿿]+/g);
  if (cjkRuns) {
    for (const run of cjkRuns) {
      for (let i = 0; i < run.length; i++) {
        const ch = run[i];
        if (!STOP.has(ch)) tokens.push(ch);
        if (i + 1 < run.length) {
          const bg = run.slice(i, i + 2);
          if (!STOP.has(bg[0]) && !STOP.has(bg[1])) tokens.push(bg);
        }
      }
    }
  }
  return tokens;
}

function buildById(entities: WikiEntity[]): Map<string, WikiEntity> {
  const m = new Map<string, WikiEntity>();
  for (const e of entities) m.set(e.id, e);
  return m;
}

/** 单实体的可检索文本（名称权重更高，故重复一次） */
function entitySearchText(e: WikiEntity, rels: WikiRelation[], byId: Map<string, WikiEntity>): string {
  const relText = rels
    .map((r) => {
      const other = byId.get(r.source === e.id ? r.target : r.source);
      return `${other?.name ?? ''} ${r.label ?? ''} ${RELATION_LABEL[r.type]}`;
    })
    .join(' ');
  const fields = [...e.fields, ...e.custom].map((f) => `${f.label} ${f.value}`).join(' ');
  return [e.name, e.name, fields, e.tags.join(' '), e.note ?? '', relText].join(' ');
}

/** 实体序列化（用于注入提示词，人类可读） */
export function entityBrief(e: WikiEntity, rels: WikiRelation[], byId: Map<string, WikiEntity>): string {
  const lines: string[] = [`【${ENTITY_LABEL[e.type]}】${e.name}`];
  const fieldLines = [...e.fields, ...e.custom]
    .filter((f) => f.value && f.value.trim())
    .map((f) => `${f.label}：${f.value}`);
  if (fieldLines.length) lines.push('  ' + fieldLines.join('；'));
  if (e.tags.length) lines.push('  标签：' + e.tags.join('、'));
  if (e.note && e.note.trim()) lines.push('  备注：' + e.note.trim());
  if (rels.length) {
    const relLines = rels.map((r) => {
      const isSrc = r.source === e.id;
      const other = byId.get(isSrc ? r.target : r.source);
      return `${isSrc ? '→' : '←'}${RELATION_LABEL[r.type]}${r.label ? '·' + r.label : ''}：${other?.name ?? '(未知)'}`;
    });
    lines.push('  关系：' + relLines.join('；'));
  }
  return lines.join('\n');
}

export interface Retrieved {
  entity: WikiEntity;
  score: number;
  related: WikiRelation[];
}

/** 轻量检索：召回与 query 最相关的 topK 个实体（排除 ignoreIds） */
export function retrieveRelevant(
  world: Pick<WorldData, 'entities' | 'relations'>,
  query: string,
  topK = 6,
  ignoreIds: Set<string> = new Set(),
): Retrieved[] {
  const entities = world.entities ?? [];
  const relations = world.relations ?? [];
  if (entities.length === 0) return [];
  const byId = buildById(entities);
  const qTokens = tokenize(query);
  if (qTokens.length === 0) {
    // 无有效查询词时回退：返回前 topK 个实体
    return entities.slice(0, topK).map((e) => ({ entity: e, score: 0, related: relations.filter((r) => r.source === e.id || r.target === e.id) }));
  }
  const qSet = new Set(qTokens);

  const scored: Retrieved[] = [];
  for (const e of entities) {
    if (ignoreIds.has(e.id)) continue;
    const rels = relations.filter((r) => r.source === e.id || r.target === e.id);
    const eTokens = new Set(tokenize(entitySearchText(e, rels, byId)));
    let overlap = 0;
    for (const t of qSet) if (eTokens.has(t)) overlap++;
    // 名称直接命中加权
    const nameHit = qTokens.some((t) => e.name.toLowerCase().includes(t) && t.length >= 1);
    const score = overlap + (nameHit ? 2 : 0);
    if (score > 0) scored.push({ entity: e, score, related: rels });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

export type AITask = '' | 'prose' | 'idea' | 'lore';

const TASK_INSTR: Record<Exclude<AITask, ''>, string> = {
  prose: '\n任务：输出为连贯的叙事正文。',
  idea: '\n任务：给出多个灵感点子，每条一句话。',
  lore: '\n任务：做考据式分析，校验设定内部逻辑一致性，并指出潜在冲突。',
};

/** 构造约束提示词：把召回设定作为「必须遵循」的上下文注入 */
export function buildConstraintPrompt(
  world: Pick<WorldData, 'entities' | 'relations'>,
  retrieved: Retrieved[],
  task: AITask = '',
): string {
  const byId = buildById(world.entities ?? []);
  if (retrieved.length === 0) {
    return (
      '你正在协助创作一个虚构世界观。当前世界暂无结构化设定，可按常识自由发挥；' +
      '若用户提到已有角色或地点，请先确认是否吻合，不要凭空捏造关键事实。' +
      (task ? TASK_INSTR[task] : '')
    );
  }
  const header = '你正在协助创作一个虚构世界观。以下是【已确立、必须遵循】的设定，你的创作与回答不得与之矛盾：\n';
  const body = retrieved.map((r) => entityBrief(r.entity, r.related, byId)).join('\n\n');
  const instr =
    '\n规则：\n' +
    '1. 严格基于上述设定创作；若用户需求与某条设定冲突，请明确指出冲突，不要默默违背。\n' +
    '2. 可在回复中以【引用：实体名】标注所参考的设定。\n' +
    '3. 不要臆造上述列表之外的关键事实（如新角色名、新地名），除非用户明确要求。';
  const taskInstr = task ? TASK_INSTR[task] : '';
  return `${header}\n${body}\n\n${instr}${taskInstr}`;
}

/** 生成后反查：输出中实际出现的实体名 → 实体 id 列表（来源标注） */
export function extractCited(output: string, entities: WikiEntity[]): string[] {
  if (!output) return [];
  const cited = new Set<string>();
  for (const e of entities) {
    if (e.name && e.name.length >= 2 && output.includes(e.name)) cited.add(e.id);
  }
  return [...cited];
}

/** 把单个实体包装成 Retrieved，供实体级 AI 补全复用 */
export function entityAsRetrieved(e: WikiEntity, relations: WikiRelation[]): Retrieved {
  return { entity: e, score: 1, related: relations.filter((r) => r.source === e.id || r.target === e.id) };
}

/* ============================================================
 * 共享 RAG 层（检索 + token 预算）—— 所有 AI 功能统一复用，
 * 杜绝「把整库实体/材料全量灌入 prompt」导致上下文撑爆。
 * ============================================================ */

/** 纯函数 token 估算（与 aiUsageStore.approximateTokens 同公式，避免 utils 反向依赖 store）。 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(/[一-鿿぀-ヿ]/g) || []).length;
  const nonCjk = text.length - cjk;
  return Math.max(1, Math.ceil(cjk * 0.8 + nonCjk * 0.25));
}

export interface ContextBlock {
  text: string;
  /** 优先级，大数优先保留（默认按传入顺序） */
  priority?: number;
  /** 块标识，用于超预算时的剔除报告 */
  label?: string;
}

export interface AssembleResult {
  /** 裁剪后拼接的上下文文本（保留原始顺序） */
  text: string;
  /** 最终占用 token 估计 */
  totalTokens: number;
  /** 因超预算被丢弃的块 */
  dropped: { label: string; tokens: number }[];
}

/**
 * 把多个上下文块按优先级拼装，并保证总 token 不超过 budget。
 * 一旦加入某块会超预算，就从最低优先级块开始丢弃，直到满足预算。
 * 这是对所有 AI 功能的「兜底保险」：任何功能只要走本函数组装，
 * 就不会因某一块过大而撑爆上下文。
 */
export function assembleContextWithBudget(
  blocks: ContextBlock[],
  budgetTokens: number,
  estimate: (s: string) => number = estimateTokens,
): AssembleResult {
  const sorted = blocks
    .map((b, i) => ({ ...b, priority: b.priority ?? i, idx: i }))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  const kept: (ContextBlock & { idx: number })[] = [];
  const dropped: { label: string; tokens: number }[] = [];
  let used = 0;
  for (const b of sorted) {
    const t = estimate(b.text);
    if (kept.length > 0 && used + t > budgetTokens) {
      dropped.push({ label: b.label ?? '(未命名块)', tokens: t });
      continue;
    }
    kept.push({ ...b, idx: b.idx });
    used += t;
  }
  kept.sort((a, b) => a.idx - b.idx);
  return { text: kept.map((b) => b.text).join('\n\n'), totalTokens: used, dropped };
}

export interface CandidatePickOpts {
  /** retrieveRelevant 召回上限（默认 80） */
  topK?: number;
  /** 候选硬上限（默认 200） */
  maxCandidates?: number;
  /** 候选列表占用的 token 预算（默认 5000） */
  budgetTokens?: number;
}

/**
 * 为大世界观下的「实体关联 / 消歧」预筛候选实体子集：
 *  1) retrieveRelevant 按词法相似度召回 topK 相关实体；
 *  2) 确定性词重叠：文中 token 与实体检索文本重叠的实体也纳入；
 *  3) 按分数排序后，硬上限裁剪，再用 token 预算从低分尾段丢弃。
 * 返回量从 O(全库) 降到 O(相关子集)，从根本上避免 prompt 撑爆。
 */
export function pickEntityCandidates(
  entities: WikiEntity[],
  relations: WikiRelation[],
  query: string,
  opts: CandidatePickOpts = {},
): WikiEntity[] {
  if (entities.length === 0) return [];
  const topK = opts.topK ?? 80;
  const maxCand = opts.maxCandidates ?? 200;
  const budget = opts.budgetTokens ?? 5000;
  const byId = buildById(entities);

  // 1) 语义/词法相关召回
  const retrieved = retrieveRelevant({ entities, relations }, query, topK);
  const picked = new Map<string, WikiEntity>();
  const scoreOf = new Map<string, number>();
  for (const r of retrieved) {
    picked.set(r.entity.id, r.entity);
    scoreOf.set(r.entity.id, r.score);
  }

  // 2) 确定性词重叠补充
  const qTokens = new Set(tokenize(query));
  if (qTokens.size > 0) {
    for (const e of entities) {
      if (picked.has(e.id)) continue;
      const rels = relations.filter((r) => r.source === e.id || r.target === e.id);
      const eTokens = new Set(tokenize(entitySearchText(e, rels, byId)));
      for (const t of qTokens) {
        if (eTokens.has(t)) {
          picked.set(e.id, e);
          scoreOf.set(e.id, Math.max(scoreOf.get(e.id) ?? 0, 1));
          break;
        }
      }
    }
  }

  let list = [...picked.values()];
  if (list.length > maxCand) list = list.slice(0, maxCand);
  // 高分优先
  list.sort((a, b) => (scoreOf.get(b.id) ?? 0) - (scoreOf.get(a.id) ?? 0));

  // 3) token 预算裁剪（逐条累加，超预算则丢低分尾段）
  const lines = list.map((e) => `- id=${e.id} | ${e.name} | ${ENTITY_LABEL[e.type] ?? e.type}`);
  let kept = lines.length;
  while (kept > 1) {
    if (estimateTokens(lines.slice(0, kept).join('\n')) <= budget) break;
    kept--;
  }
  return list.slice(0, kept);
}

/**
 * 文章抽取去重：召回与正文最相关的已有实体，作为「应当复用、勿重复创建」的参考。
 * 仅取 topK（默认 40），从源头避免整库注入。
 */
export function retrieveExistingForExtraction(
  world: Pick<WorldData, 'entities' | 'relations'>,
  text: string,
  topK = 40,
): Retrieved[] {
  return retrieveRelevant(world, text, topK);
}

/** 约束提示词组合：用户自定义人格前缀 + 设定约束块 */
export function composeSystem(modelSystemPrompt: string | undefined, constraintBlock: string): string {
  if (modelSystemPrompt && modelSystemPrompt.trim()) return `${modelSystemPrompt.trim()}\n\n${constraintBlock}`;
  return constraintBlock;
}

export const RELATION_TYPES: RelationType[] = ['belongs', 'enemy', 'occurs', 'causal', 'kin', 'custom'];

/* ============================================================
 * 语义检索（Embedding）—— 在已配置共享嵌入模型时，用语义向量
 * 召回最相关实体，解决词法检索无法命中「近义 / 改写提及」的短板。
 * 不配置或调用失败时自动回退到词法检索（retrieveRelevant），
 * 保证任何调用方都能拿到结果，不会因嵌入层异常而中断功能。
 * ============================================================ */

/** 实体向量缓存：键=实体 id，避免每次调用都重算全部实体嵌入 */
const embCache = new Map<string, { hash: string; vec: number[] }>();

/** 轻量字符串哈希（FNV-1a），用于判断实体可检索文本是否变化 */
function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/** 余弦相似度 */
function cosine(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * 获取实体向量（带两级缓存）。
 *  L1：进程内 embCache（同会话最快）；
 *  L2：落盘向量索引（embeddingIndex，重启后仍可用，避免冷启动全量重嵌）。
 * 仅对「两级缓存均缺失 / 文本哈希变化」的实体批量调用嵌入接口，降低 API 开销。
 */
async function getEntityVectors(
  worldId: string,
  entities: WikiEntity[],
  relations: WikiRelation[],
  byId: Map<string, WikiEntity>,
): Promise<Map<string, number[]>> {
  const embModel = useAIStore.getState().embeddingModel;
  const out = new Map<string, number[]>();
  if (!embModel) return out;
  const dim = embModel.dimensions || 0;
  const hashes: string[] = [];
  const idxOf: number[] = []; // 仍需计算嵌入的实体下标
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    const rels = relations.filter((r) => r.source === e.id || r.target === e.id);
    const text = entitySearchText(e, rels, byId);
    const h = hashText(text);
    hashes.push(h);
    const cached = embCache.get(e.id);
    if (cached && cached.hash === h) {
      out.set(e.id, cached.vec);
    } else {
      idxOf.push(i);
    }
  }
  // L2：批量查落盘索引，命中且哈希匹配的直接复用（不调 API）
  if (idxOf.length > 0) {
    const idxOfId = new Map<string, number>();
    idxOf.forEach((i) => idxOfId.set(entities[i].id, i));
    const items = idxOf.map((i) => ({ id: entities[i].id, hash: hashes[i] }));
    const cached = getCachedVectors(worldId, items);
    cached.forEach((vec, id) => {
      const ii = idxOfId.get(id);
      if (ii !== undefined) {
        embCache.set(id, { hash: hashes[ii], vec });
        out.set(id, vec);
        idxOfId.delete(id);
      }
    });
    const remaining = [...idxOfId.values()];
    if (remaining.length === 0) return out;
    // 用 remaining 替换 idxOf，继续走嵌入
    (idxOf as number[]).length = 0;
    idxOf.push(...remaining);
  }
  if (idxOf.length === 0) return out;
  const toEmbed = idxOf.map((i) => entitySearchText(entities[i], relations.filter((r) => r.source === entities[i].id || r.target === entities[i].id), byId));
  let vecs: number[][] = [];
  try {
    vecs = await embedTexts(embModel, toEmbed);
  } catch {
    return out; // 嵌入失败：返回已缓存部分，未命中的实体走词法兜底
  }
  const entries: { entityId: string; hash: string; vec: number[] }[] = [];
  idxOf.forEach((entityIdx, k) => {
    const vec = vecs[k];
    if (vec && vec.length) {
      embCache.set(entities[entityIdx].id, { hash: hashes[entityIdx], vec });
      out.set(entities[entityIdx].id, vec);
      entries.push({ entityId: entities[entityIdx].id, hash: hashes[entityIdx], vec });
    }
  });
  if (entries.length) upsertVectors(worldId, dim, entries); // 持久化到磁盘索引
  return out;
}

/** 清空嵌入缓存（切换世界或大量变更后可手动调用）；同时清空落盘索引的内存态。 */
export function clearEmbeddingCache(): void {
  embCache.clear();
  clearEmbeddingIndexMemory();
}

/**
 * 语义检索：召回与 query 最相关的 topK 实体。
 * - 未配置嵌入模型：直接回退词法检索。
 * - 嵌入调用异常：回退词法检索。
 * 其余行为和 retrieveRelevant 一致（返回 Retrieved[]，支持 ignoreIds）。
 */
export async function retrieveRelevantSemantic(
  world: Pick<WorldData, 'entities' | 'relations'>,
  query: string,
  topK = 6,
  ignoreIds: Set<string> = new Set(),
  worldId?: string,
): Promise<Retrieved[]> {
  const entities = world.entities ?? [];
  const relations = world.relations ?? [];
  if (entities.length === 0) return [];
  const embModel = useAIStore.getState().embeddingModel;
  if (!embModel) return retrieveRelevant(world, query, topK, ignoreIds);

  try {
    const byId = buildById(entities);
    const vectors = await getEntityVectors(worldId ?? useWorldStore.getState().current, entities, relations, byId);
    const qVec = (await embedTexts(embModel, [query]))[0];
    if (!qVec || !qVec.length || vectors.size === 0) return retrieveRelevant(world, query, topK, ignoreIds);

    const scored: Retrieved[] = [];
    for (const e of entities) {
      if (ignoreIds.has(e.id)) continue;
      const vec = vectors.get(e.id);
      if (!vec) continue;
      const score = cosine(qVec, vec);
      if (score > 0) {
        scored.push({ entity: e, score, related: relations.filter((r) => r.source === e.id || r.target === e.id) });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  } catch {
    return retrieveRelevant(world, query, topK, ignoreIds);
  }
}
