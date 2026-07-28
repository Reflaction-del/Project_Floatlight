// M7 协作与分享 · 本地可行版
// 说明：开发文档中的 M7 规划依赖后端（分享鉴权外链 / Yjs 实时协同 / 账号体系）。
// 本项目为纯前端、无后端、本地优先，因此落地「不依赖服务器」的等价能力：
//   M7-1 可控分享：勾选部分实体/文档 → 导出范围可控的分享快照（JSON）+ 独立只读 HTML 查看器（接收方无需安装软件）。
//   M7-3 评论与版本：实体级评论、版本快照与回滚（见 worldStore / EntityEditor）。
//   M7-2 实时协同：需后端+账号，本构建无法直接实现；以「合并导入（冲突可视化选择）」作为本地替代（见 SharePanel）。

import type {
  WikiEntity,
  WikiRelation,
  DocFile,
  EntityType,
  RelationType,
} from '../types';
import { ENTITY_LABEL, RELATION_LABEL } from '../types';

/* ============================================================
 * 分享范围选项
 * ============================================================ */
export interface ShareOptions {
  /** 选中的实体 id（仅这些会被导出） */
  entityIds: string[];
  /** 选中的文档 id（可选，默认不选） */
  docIds?: string[];
  /** 是否仅导出选中实体的「可见字段」（勾选字段名才导出值，否则留空） */
  fieldWhitelist?: string[] | null; // null = 全部字段
  /** 过期时间（毫秒时间戳），0/undefined = 不过期 */
  expireAt?: number;
  /** 分享标题 / 说明 */
  title?: string;
  note?: string;
}

export interface SharePayload {
  format: 'fugu-share';
  v: number;
  world: string;
  createdAt: number;
  scope: {
    mode: 'read';
    expireAt?: number;
    entityIds: string[];
    docIds: string[];
    fields: string[] | null;
  };
  /** 分享标题（用于 HTML 查看器顶部，可选） */
  title?: string;
  /** 分享说明（可选） */
  note?: string;
  entities: WikiEntity[];
  relations: WikiRelation[];
  docs?: { id: string; title: string; icon: string; content: string }[];
}

/** 按范围裁剪实体字段 */
function applyScope(entity: WikiEntity, opts: ShareOptions): WikiEntity {
  if (!opts.fieldWhitelist) return entity;
  const allow = new Set(opts.fieldWhitelist);
  return {
    ...entity,
    fields: entity.fields.filter((f) => allow.has(f.label)),
    custom: entity.custom.filter((c) => allow.has(c.label)),
    comments: [],
    versions: [],
  };
}

/** 构建可分享的 JSON 快照 */
export function buildSharePayload(
  world: string,
  allEntities: WikiEntity[],
  allRelations: WikiRelation[],
  allDocs: DocFile[],
  opts: ShareOptions,
): SharePayload {
  const idSet = new Set(opts.entityIds);
  const entities = allEntities.filter((e) => idSet.has(e.id)).map((e) => applyScope(e, opts));
  // 仅保留两端都在范围内的关系，并剥离指向范围外实体的引用
  const relations = allRelations.filter((r) => idSet.has(r.source) && idSet.has(r.target));
  const docs = (opts.docIds && opts.docIds.length
    ? allDocs.filter((d) => opts.docIds!.includes(d.id))
    : []
  ).map((d) => ({ id: d.id, title: d.title, icon: d.icon, content: JSON.stringify(d.content) }));

  return {
    format: 'fugu-share',
    v: 1,
    world,
    createdAt: Date.now(),
    scope: {
      mode: 'read',
      expireAt: opts.expireAt || undefined,
      entityIds: [...opts.entityIds],
      docIds: opts.docIds ?? [],
      fields: opts.fieldWhitelist ?? null,
    },
    title: opts.title,
    note: opts.note,
    entities,
    relations,
    docs: docs.length ? docs : undefined,
  };
}

/** 生成一份独立、自包含的只读 HTML 查看器（接收方双击即可在浏览器查看，无需安装软件） */
export function buildShareHTML(payload: SharePayload): string {
  const data = JSON.stringify(payload);
  const headTitle = payload.title || `「${payload.world}」设定分享`;
  const headNote = payload.note || '';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(headTitle)}</title>
<style>
  :root { color-scheme: dark light; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; background: #0f1115; color: #e7e9ee; padding: 28px 16px 60px; }
  .wrap { max-width: 980px; margin: 0 auto; }
  header { border-bottom: 1px solid #2a2f3a; padding-bottom: 14px; margin-bottom: 22px; }
  h1 { font-size: 22px; margin: 0 0 6px; }
  .meta { font-size: 12px; color: #8b93a7; display: flex; gap: 14px; flex-wrap: wrap; }
  .expire-warn { color: #f0a85a; }
  .note { font-size: 13px; color: #b9c0d0; margin-top: 8px; white-space: pre-wrap; }
  .filters { display: flex; gap: 8px; flex-wrap: wrap; margin: 0 0 18px; }
  .chip { background: #1b2230; border: 1px solid #2a3346; color: #cdd4e3; padding: 5px 12px; border-radius: 999px; font-size: 12px; cursor: pointer; }
  .chip.active { background: #2b5cff; border-color: #2b5cff; color: #fff; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
  .card { background: #161b25; border: 1px solid #232a38; border-radius: 12px; padding: 14px 16px; }
  .card h3 { margin: 0 0 2px; font-size: 16px; display: flex; align-items: center; gap: 8px; }
  .card .type { font-size: 11px; color: #8b93a7; }
  .kv { margin: 8px 0 0; font-size: 13px; }
  .kv .k { color: #7e8699; display: inline-block; min-width: 64px; }
  .kv .v { color: #dfe4ee; }
  .tags { margin-top: 8px; }
  .tag { display: inline-block; background: #212838; border: 1px solid #2c374a; color: #9fb0cf; font-size: 11px; padding: 2px 8px; border-radius: 6px; margin: 2px 4px 0 0; }
  .rel { font-size: 12px; color: #9aa3b6; margin-top: 10px; border-top: 1px dashed #2a3140; padding-top: 8px; }
  .empty { color: #7e8699; text-align: center; padding: 40px; }
  footer { margin-top: 40px; text-align: center; font-size: 11px; color: #5e6678; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1 id="title"></h1>
    <div class="meta" id="meta"></div>
    <div class="note" id="note"></div>
  </header>
  <div class="filters" id="filters"></div>
  <div class="grid" id="grid"></div>
  <footer>由「浮光 · AI 世界观编辑器」生成 · 本文件为离线只读分享，无需联网即可查看</footer>
</div>
<script>
const PAYLOAD = ${data};
const LABEL = ${JSON.stringify(ENTITY_LABEL)};
const LABEL = ${JSON.stringify(ENTITY_LABEL)};
const RL = ${JSON.stringify(RELATION_LABEL)};
const nameOf = (id) => (PAYLOAD.entities.find(e => e.id === id) || {}).name || '(未知)';

function escapeHtml(s){ return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

document.getElementById('title').textContent = ${JSON.stringify(headTitle)};
const meta = document.getElementById('meta');
meta.innerHTML = '<span>世界：' + escapeHtml(PAYLOAD.world) + '</span><span>实体：' + PAYLOAD.entities.length + ' 个</span><span>关系：' + PAYLOAD.relations.length + ' 条</span>'
  + (PAYLOAD.scope.expireAt ? '<span class="expire-warn">有效期至 ' + new Date(PAYLOAD.scope.expireAt).toLocaleString() + '</span>' : '');
document.getElementById('note').textContent = ${JSON.stringify(headNote)};

let activeType = 'all';
const types = ['all', ...Array.from(new Set(PAYLOAD.entities.map(e => e.type)))];
const filters = document.getElementById('filters');
types.forEach(t => {
  const b = document.createElement('div');
  b.className = 'chip' + (t === activeType ? ' active' : '');
  b.textContent = t === 'all' ? '全部' : (LABEL[t] || t);
  b.onclick = () => { activeType = t; document.querySelectorAll('.chip').forEach(c => c.classList.remove('active')); b.classList.add('active'); render(); };
  filters.appendChild(b);
});

function render() {
  const grid = document.getElementById('grid');
  grid.innerHTML = '';
  const list = PAYLOAD.entities.filter(e => activeType === 'all' || e.type === activeType);
  if (!list.length) { grid.innerHTML = '<div class="empty">没有可导出的设定</div>'; return; }
  list.forEach(e => {
    const card = document.createElement('div'); card.className = 'card';
    let rows = '';
    (e.fields || []).concat(e.custom || []).forEach(f => { if (f.value && f.value.trim()) rows += '<div class="kv"><span class="k">'+escapeHtml(f.label)+'</span><span class="v">'+escapeHtml(f.value)+'</span></div>'; });
    let tags = ''; (e.tags || []).forEach(t => tags += '<span class="tag">'+escapeHtml(t)+'</span>');
    let rels = '';
    PAYLOAD.relations.filter(r => r.source === e.id).forEach(r => { rels += '<div>'+escapeHtml(RL[r.type]||r.type)+' → '+escapeHtml(nameOf(r.target))+(r.label?'（'+escapeHtml(r.label)+'）':'')+'</div>'; });
    card.innerHTML = '<h3>'+escapeHtml(e.name||'(未命名)')+'</h3>'
      + '<div class="type">'+(LABEL[e.type]||e.type)+'</div>'
      + (rows ? '<div class="kv-wrap">'+rows+'</div>' : '')
      + (tags ? '<div class="tags">'+tags+'</div>' : '')
      + (e.note ? '<div class="kv"><span class="k">备注</span><span class="v">'+escapeHtml(e.note)+'</span></div>' : '')
      + (rels ? '<div class="rel">'+rels+'</div>' : '');
    grid.appendChild(card);
  });
}
render();
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

/* ============================================================
 * 合并导入冲突检测（M7-2 本地替代）
 * ============================================================ */
export interface MergeConflict {
  /** 导入实体的本地对应（id 或 name 命中） */
  localId: string;
  importedId: string;
  name: string;
  /** id 命中 / name 命中 */
  kind: 'id' | 'name';
}

export function detectConflicts(
  existing: WikiEntity[],
  imported: WikiEntity[],
): MergeConflict[] {
  const byId = new Map(existing.map((e) => [e.id, e]));
  const byName = new Map(existing.map((e) => [e.name, e]));
  const out: MergeConflict[] = [];
  for (const im of imported) {
    if (byId.has(im.id)) {
      out.push({ localId: im.id, importedId: im.id, name: im.name, kind: 'id' });
    } else if (im.name && byName.has(im.name)) {
      const local = byName.get(im.name)!;
      out.push({ localId: local.id, importedId: im.id, name: im.name, kind: 'name' });
    }
  }
  return out;
}

/** 解析策略：用于冲突项 */
export type MergeStrategy = 'keep' | 'replace' | 'rename';

export interface MergeResolution {
  conflict: MergeConflict;
  strategy: MergeStrategy;
}

/**
 * 根据冲突决议，产出最终要落库的实体与关系列表。
 * - keep：保留本地，丢弃导入
 * - replace：用导入覆盖本地（沿用本地 id）
 * - rename：保留本地，导入以新 id 追加
 */
export function resolveMerge(
  existing: WikiEntity[],
  imported: WikiEntity[],
  relations: WikiRelation[],
  resolutions: MergeResolution[],
  reId: (oldId: string) => string,
): { entities: WikiEntity[]; relations: WikiRelation[] } {
  const resMap = new Map(resolutions.map((r) => [r.conflict.importedId, r.strategy]));
  const keepIds = new Set(
    resolutions.filter((r) => r.strategy === 'keep').map((r) => r.conflict.importedId),
  );
  const outEntities: WikiEntity[] = [];
  const idRemap = new Map<string, string>(); // 旧导入 id -> 新 id（replace 沿用本地，rename 新 id）

  for (const im of imported) {
    const strat = resMap.get(im.id);
    if (strat === 'keep') continue; // 丢弃导入
    if (strat === 'replace') {
      const localId = resolutions.find((r) => r.conflict.importedId === im.id)?.conflict.localId;
      outEntities.push({ ...im, id: localId! });
      idRemap.set(im.id, localId!);
    } else if (strat === 'rename') {
      // rename：新 id 追加
      const nid = reId(im.id);
      outEntities.push({ ...im, id: nid });
      idRemap.set(im.id, nid);
    } else {
      // 无冲突：保留原 id 直接追加
      outEntities.push({ ...im });
    }
  }

  // 关系：替换其中被 rename 的端点 id
  const outRelations: WikiRelation[] = relations.map((r) => ({
    ...r,
    source: idRemap.get(r.source) || r.source,
    target: idRemap.get(r.target) || r.target,
  }));

  return { entities: outEntities, relations: outRelations };
}

/* 辅助：从任意 JSON 解析出实体/关系（兼容分享快照与世界完整备份两种格式） */
export function extractShareEntities(content: string): { entities: WikiEntity[]; relations: WikiRelation[]; world: string } | null {
  try {
    const p = JSON.parse(content);
    if (p && p.format === 'fugu-share' && Array.isArray(p.entities)) {
      return { entities: p.entities, relations: p.relations || [], world: p.world || '分享导入' };
    }
    if (p && p.data && Array.isArray(p.data.entities)) {
      return { entities: p.data.entities, relations: p.data.relations || [], world: p.name || '世界导入' };
    }
    if (p && Array.isArray(p.entities)) {
      return { entities: p.entities, relations: p.relations || [], world: p.world || '世界导入' };
    }
  } catch {
    /* ignore */
  }
  return null;
}

export type { EntityType, RelationType };
