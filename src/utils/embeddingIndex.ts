// 语义索引（Semantic Index）持久层
// 为每个世界保存一份实体向量索引（fl-emb-<worldId>.json），使「语义检索」在应用重启后
// 不必对全部实体重新嵌入（解决冷启动爆量 API 调用 + 卡顿），并支持手动更新 / 清除 / 自动索引。
//
// 设计要点：
//  - 落盘前先经 safeName 处理文件名（主进程禁止子目录），故索引以「单文件名 + worldId」区分；
//  - 内存缓存（mem）作为同会话 L1，磁盘文件作为 L2，二者均按 worldId 隔离；
//  - 所有嵌入调用都走增量（仅对哈希变化的实体），无论手动还是自动，开销都极小。

import { storage } from '../storage';
import { useAIStore, type EmbeddingModel, type IndexPolicy, DEFAULT_INDEX_POLICY } from '../store/aiStore';
import { useWorldStore } from '../store/worldStore';
import { embedTexts } from './ai';
import { RELATION_LABEL, ENTITY_LABEL } from '../types';
import type { WikiEntity, WikiRelation } from '../types';

export interface EntityVector {
  hash: string;       // 实体可检索文本的 FNV-1a 哈希，用于判断是否需要重算
  vec: number[];
  updatedAt: number;
}
export interface WorldEmbeddingIndex {
  worldId: string;
  dim: number;        // 嵌入维度；维度变化视为失效，整体重置
  entities: Record<string, EntityVector>;
  updatedAt: number;
}

const CHUNK = 64; // 单次嵌入请求的实体批量上限，避免超大 payload

/* ——— 与 worldContext.entitySearchText 保持一致的检索文本（本地副本，避免循环依赖） ——— */
function buildById(entities: WikiEntity[]): Map<string, WikiEntity> {
  const m = new Map<string, WikiEntity>();
  for (const e of entities) m.set(e.id, e);
  return m;
}
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

/** 轻量字符串哈希（FNV-1a），用于判断实体可检索文本是否变化 */
function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

function indexFileName(worldId: string): string {
  const safe = String(worldId).replace(/[\\/:*?"<>|]/g, '_');
  return `fl-emb-${safe}.json`;
}

/* ——— 内存缓存（同会话 L1） ——— */
let mem: WorldEmbeddingIndex | null = null;
let memId: string | null = null;

/** 清空内存缓存（不触盘）；切换世界/代码层兜底时使用 */
export function clearMemory(): void {
  mem = null;
  memId = null;
}

function loadIndex(worldId: string): WorldEmbeddingIndex | null {
  if (mem && memId === worldId) return mem;
  const raw = storage.readFile(indexFileName(worldId));
  if (!raw) {
    mem = null;
    memId = null;
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as WorldEmbeddingIndex;
    if (!parsed || typeof parsed !== 'object' || !parsed.entities) return null;
    mem = parsed;
    memId = worldId;
    return mem;
  } catch {
    mem = null;
    memId = null;
    return null;
  }
}

function saveIndex(idx: WorldEmbeddingIndex): void {
  mem = idx;
  memId = idx.worldId;
  try {
    storage.writeFile(indexFileName(idx.worldId), JSON.stringify(idx));
  } catch {
    /* 写入失败不影响内存态 */
  }
}

/** 批量取缓存向量：仅返回「存在且哈希匹配」的实体向量（L2 磁盘，内存优先） */
export function getCachedVectors(worldId: string, items: { id: string; hash: string }[]): Map<string, number[]> {
  const idx = loadIndex(worldId);
  const out = new Map<string, number[]>();
  if (!idx) return out;
  for (const it of items) {
    const v = idx.entities[it.id];
    if (v && v.hash === it.hash && v.vec && v.vec.length) out.set(it.id, v.vec);
  }
  return out;
}

/** 增量写入向量；维度变化则整体重置（旧向量维度不一致必须作废） */
export function upsertVectors(worldId: string, dim: number, entries: { entityId: string; hash: string; vec: number[] }[]): void {
  let idx = loadIndex(worldId);
  if (!idx || idx.worldId !== worldId) idx = { worldId, dim, entities: {}, updatedAt: 0 };
  if (dim && idx.dim && idx.dim !== dim) idx = { worldId, dim, entities: {}, updatedAt: 0 };
  else if (dim) idx.dim = dim;
  for (const e of entries) idx.entities[e.entityId] = { hash: e.hash, vec: e.vec, updatedAt: Date.now() };
  idx.updatedAt = Date.now();
  saveIndex(idx);
}

/** 清除某世界的索引（覆写为空索引文件） */
export function clearIndex(worldId: string): void {
  const empty: WorldEmbeddingIndex = { worldId, dim: 0, entities: {}, updatedAt: 0 };
  saveIndex(empty);
  if (memId === worldId) mem = empty;
}

/** 索引统计：实体数 / 最近更新时间 / 索引体积（字节） */
export function getIndexStats(worldId: string): { count: number; updatedAt: number; sizeBytes: number } | null {
  const idx = loadIndex(worldId);
  if (!idx) return null;
  return {
    count: Object.keys(idx.entities).length,
    updatedAt: idx.updatedAt,
    sizeBytes: JSON.stringify(idx).length,
  };
}

export interface RebuildResult {
  indexed: number;   // 本次新嵌入 / 重算的实体数
  skipped: number;   // 哈希未变化、直接复用的实体数
}

/**
 * 增量重建索引：只嵌入「缺失 / 文本哈希变化」的实体；force=true 时全量重写。
 * 按 CHUNK 分块调用嵌入接口，避免超大 payload。返回本次实际嵌入 / 跳过的实体数。
 */
export async function rebuildIndexDelta(
  worldId: string,
  entities: WikiEntity[],
  relations: WikiRelation[],
  model: EmbeddingModel,
  opts: { force?: boolean; onProgress?: (done: number, total: number) => void } = {},
): Promise<RebuildResult> {
  if (!entities.length) return { indexed: 0, skipped: 0 };
  const byId = buildById(entities);
  const idx = loadIndex(worldId);
  const dim = model.dimensions || 0;

  type Item = { id: string; hash: string; text: string };
  const items: Item[] = [];
  let skipped = 0;
  for (const e of entities) {
    const rels = relations.filter((r) => r.source === e.id || r.target === e.id);
    const text = entitySearchText(e, rels, byId);
    const hash = hashText(text);
    if (!opts.force && idx && idx.entities[e.id] && idx.entities[e.id].hash === hash) {
      skipped++;
      continue;
    }
    items.push({ id: e.id, hash, text });
  }

  let indexed = 0;
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    const vecs = await embedTexts(model, chunk.map((c) => c.text));
    const entries: { entityId: string; hash: string; vec: number[] }[] = [];
    chunk.forEach((c, k) => {
      const vec = vecs[k];
      if (vec && vec.length) entries.push({ entityId: c.id, hash: c.hash, vec });
    });
    if (entries.length) upsertVectors(worldId, dim, entries);
    indexed += entries.length;
    opts.onProgress?.(Math.min(i + CHUNK, items.length), items.length);
  }
  return { indexed, skipped };
}

/* ——— 自动索引：订阅世界数据变更，按策略防抖增量重建 ——— */
let autoTimer: ReturnType<typeof setTimeout> | null = null;
let lastSig = '';

/** 轻量签名：实体数 + 抽样实体名/更新时间，避免每次全量 hash */
function entitySig(entities: WikiEntity[], relations: WikiRelation[]): string {
  let h = entities.length * 31 + relations.length;
  const step = Math.max(1, Math.floor(entities.length / 20));
  for (let i = 0; i < entities.length; i += step) {
    const nameHash = parseInt(hashText(entities[i].name + (entities[i].updatedAt || 0)), 16) || 0;
    h = (h * 31 + nameHash) >>> 0;
  }
  return h.toString(16);
}

function currentPolicy(): IndexPolicy {
  return useAIStore.getState().embeddingModel?.indexPolicy ?? DEFAULT_INDEX_POLICY;
}

/**
 * 启动自动索引监听（在 main.tsx 应用初始化后调用一次）。
 * - manual：完全不自动；
 * - onEntityChange / onSave：实体或关系发生变更后，按防抖时间增量重建索引。
 * 重建本身只嵌入哈希变化的实体，对大模型 API 的压力极小。
 */
export function initAutoIndex(): void {
  try {
    useWorldStore.subscribe((state) => {
      const policy = currentPolicy();
      if (policy.mode === 'manual') return;
      const wid = state.current;
      const wd = state.worldsData[wid];
      if (!wd) return;
      const sig = entitySig(wd.entities, wd.relations);
      if (sig === lastSig) return;
      lastSig = sig;
      const emb = useAIStore.getState().embeddingModel;
      if (!emb) return;
      if (autoTimer) clearTimeout(autoTimer);
      autoTimer = setTimeout(() => {
        rebuildIndexDelta(wid, wd.entities, wd.relations, emb).catch(() => {
          /* 自动索引失败静默忽略，不阻塞主流程 */
        });
      }, policy.debounceMs || 3000);
    });
  } catch {
    /* 订阅失败不影响主流程 */
  }
}
