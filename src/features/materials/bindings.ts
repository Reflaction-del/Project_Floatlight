// ============================================================
// 视觉物料生成器 · 绑定解析层（P0-5）
// ------------------------------------------------------------
// 把模板里的 FieldBinding / TextBlock 插值 / showIf / TableBlock 行
// 解析成具体字符串或行数据，供 TemplateRenderer 渲染。
// 全部为纯函数，不依赖 React / Electron，便于单测与序列化复用。
//
// 字段来源说明：
//   - 实体插图在 WikiEntity.images[].dataUrl（注意不是 src）
//   - 用户决策 #3：customField 按 materialFields[key] 映射；
//     为兼容旧数据，materialFields 缺 key 时回退到 custom[label] 匹配。
//   - 头像三模式（用户决策 #2）：image:portrait 按 portraitMode 取源。
// ============================================================

import type { StyleToken, FieldBinding, Block, PortraitMode, SpectrumBlock } from './types';
import type { WikiEntity } from '../../types';

export interface RenderContext {
  entity: WikiEntity | null;
  worldName: string;
  token: StyleToken;
  portraitMode: PortraitMode;
  useAI: boolean;
  /** 全量实体（用于 关系循环 repeat 按 ID 查表；P2-A） */
  allEntities: WikiEntity[];
  /** AI 生成字段的实时值（source:'ai'，P2-D）。未生成时为空，对应块按空值隐藏。 */
  aiValues?: Record<string, string>;
}

/** 表格行的归一结构：列绑定 __key__ / __value__ 统一读取 */
export type RowMap = { key: string; value: string };

/* ---------- 头像解析（三模式） ---------- */
function resolvePortrait(ctx: RenderContext): string {
  const e = ctx.entity;
  if (!e) return '';
  const p = e.portrait;
  if (ctx.portraitMode === 'upload') return p?.uploadSrc ?? '';
  if (ctx.portraitMode === 'ai') return p?.aiSrc ?? '';
  // 'entity'：优先 portrait.imageId 指向的插图，否则封面图 / 首图
  const id = p?.imageId ?? e.coverImageId;
  const img = e.images?.find((i) => i.id === id) ?? e.images?.[0];
  return img?.dataUrl ?? '';
}

/* ---------- 单条绑定解析 ---------- */
export function resolveBinding(b: FieldBinding, ctx: RenderContext): string {
  switch (b.source) {
    case 'entity': {
      const e = ctx.entity;
      if (!e) return b.fallback ?? '';
      const rec = e as unknown as Record<string, unknown>;
      const v = rec[b.path];
      if (v != null && v !== '') return String(v);
      // 回退：结构化字段按 label 匹配（如 {entity:身份}）
      const field = e.fields?.find((f) => f.label === b.path);
      if (field && field.value != null && field.value !== '') return field.value;
      return b.fallback ?? '';
    }
    case 'customField':
    case 'field': {    // {field:path} 与 customField 等价：按 key 读取 materialFields
      if (b.path === '*') return ''; // '*' 仅用于 showIf 通配
      const e = ctx.entity;
      const mf = e?.materialFields;
      if (mf && b.path in mf && mf[b.path] != null && mf[b.path] !== '') return mf[b.path];
      const hit = e?.custom?.find((c) => c.label === b.path);
      if (hit && hit.value) return hit.value;
      return b.fallback ?? '';
    }
    case 'world':
      if (b.path === 'worldName') return ctx.worldName;
      return b.fallback ?? '';
    case 'style': {
      if (b.path === 'logo') return ctx.token.logo.src;
      if (b.path === 'accent') return ctx.token.palette.accent;
      const pal = ctx.token.palette as unknown as Record<string, string>;
      return pal[b.path] ?? b.fallback ?? '';
    }
    case 'image': {
      if (b.path === 'portrait') return resolvePortrait(ctx);
      if (b.path === 'logo') return ctx.token.logo.src;
      return b.fallback ?? '';
    }
    case 'static':
      return b.static ?? '';
    case 'relation':
      return b.fallback ?? '';
    case 'ai':
      // AI 生成字段：优先取实时 aiValues（待审核态），否则回退到已采用的 materialFields，
      // 再回退兜底文案。未生成且无兜底时返回空字符串 → 对应块按空值隐藏。
      return (
        ctx.aiValues?.[b.path] ??
        ctx.entity?.materialFields?.[b.path] ??
        b.fallback ??
        ''
      );
    default:
      return b.fallback ?? '';
  }
}

/* ---------- SpectrumBlock 颜色解析 ---------- */
export function resolveSpectrumColor(b: SpectrumBlock, ctx: RenderContext): string {
  const mode = b.colorMode ?? 'binding';
  if (mode === 'custom') return b.customColor || '';
  if (mode === 'rules' && b.colorRules && b.colorRules.length > 0 && b.detectBinding) {
    const detected = resolveBinding(b.detectBinding, ctx);
    for (const rule of b.colorRules) {
      const op = rule.operator ?? 'eq';
      const val = rule.value;
      switch (op) {
        case 'eq':
          if (detected === val) return rule.color;
          break;
        case 'contains':
          if (detected.includes(val)) return rule.color;
          break;
        case 'startsWith':
          if (detected.startsWith(val)) return rule.color;
          break;
        case 'endsWith':
          if (detected.endsWith(val)) return rule.color;
          break;
      }
    }
    // 无命中时兜底：优先 binding 值，其次透明
    return b.binding ? resolveBinding(b.binding, ctx) : '';
  }
  return b.binding ? resolveBinding(b.binding, ctx) : '';
}

/* ---------- TextBlock 插值 ---------- */
const TOKEN_RE = /\{(\w+):([^}]+)\}/g;
export function interpolate(content: string, ctx: RenderContext): string {
  return content.replace(TOKEN_RE, (_m, src: string, path: string) => {
    const b: FieldBinding = { source: src as FieldBinding['source'], path: path.trim() };
    return resolveBinding(b, ctx) || '';
  });
}

/* ---------- 语气词典替换 ---------- */
export function applyTone(text: string, token: StyleToken): string {
  let out = text;
  for (const w of token.tone.dictionary) {
    if (w.from) out = out.split(w.from).join(w.to || '');
  }
  return out;
}

/* ---------- showIf 条件渲染 ---------- */
export function resolveShowIf(
  showIf: NonNullable<Block['showIf']>,
  ctx: RenderContext,
): boolean {
  const { source, path, notEmpty, equals } = showIf;
  let value = '';
  if (source === 'customField' && path === '*') {
    const e = ctx.entity;
    const has =
      !!e &&
      (((e.materialFields && Object.keys(e.materialFields).length > 0) ||
        (e.custom && e.custom.length > 0)));
    value = has ? 'yes' : '';
  } else {
    value = resolveBinding({ source, path }, ctx);
  }
  if (notEmpty) return value.trim() !== '';
  if (equals != null) return value === equals;
  return true;
}

/* ---------- TableBlock 行解析 ---------- */
export function resolveTableRows(
  block: Extract<Block, { type: 'table' }>,
  ctx: RenderContext,
): RowMap[] {
  const fromStatic = (): RowMap[] =>
    (block.staticRows ?? []).map((r) => ({ key: r.cells[0] ?? '', value: r.cells[1] ?? '' }));

  if (block.rows === 'customFields') {
    const e = ctx.entity;
    const rows: RowMap[] = [];
    if (e?.materialFields) {
      for (const [k, v] of Object.entries(e.materialFields)) rows.push({ key: k, value: v });
    }
    if (rows.length === 0 && e?.custom) {
      for (const c of e.custom) rows.push({ key: c.label, value: c.value });
    }
    return rows.length > 0 ? rows : fromStatic();
  }
  if (block.rows === 'entityFields') {
    const rows = (ctx.entity?.fields ?? []).map((f) => ({ key: f.label, value: f.value }));
    return rows.length > 0 ? rows : fromStatic();
  }
  return fromStatic();
}

/* ---------- 单元格解析（支持 __key__ / __value__ 行内通配） ---------- */
export function resolveCell(b: FieldBinding, ctx: RenderContext, row?: RowMap): string {
  if (b.source === 'customField') {
    if (b.path === '__key__') return row?.key ?? '';
    if (b.path === '__value__') return row?.value ?? '';
  }
  return resolveBinding(b, ctx);
}

/* ---------- 关系循环（repeat block，P2-A） ----------
 * RepeatBlock.source.entityId 绑定解析为「逗号/空格分隔的实体 ID 串」，
 * 在 allEntities 中查表得到实体集合；relation 可选，作为实体 type 过滤。
 * 返回用于逐个渲染 itemTemplate 的实体列表。 */
export function resolveRepeatEntities(
  block: Extract<Block, { type: 'repeat' }>,
  ctx: RenderContext,
): WikiEntity[] {
  const raw = block.source.entityId ? resolveBinding(block.source.entityId, ctx) : '';
  const ids = raw
    .split(/[,\s，;；]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) return [];
  let found = ctx.allEntities.filter((e) => ids.includes(e.id));
  if (block.source.relation) found = found.filter((e) => e.type === block.source.relation);
  return found;
}

/* ---------- 收集模板里的 AI 生成字段（source:'ai'，P2-D） ----------
 * 递归遍历 Block 树（含 group / repeat.itemTemplate / table.columns），
 * 返回去重后的 { path, label }：path 作为字段 key，binding.static 作为人类可读标签。 */
export interface AIFieldSpec {
  path: string;
  label: string;
}
export function collectAIFields(blocks: Block[]): AIFieldSpec[] {
  const out: AIFieldSpec[] = [];
  const seen = new Set<string>();
  const push = (b: FieldBinding | undefined) => {
    if (b && b.source === 'ai' && b.path && !seen.has(b.path)) {
      seen.add(b.path);
      out.push({ path: b.path, label: b.static?.trim() || b.path });
    }
  };
  const walk = (list: Block[]) => {
    for (const blk of list) {
      const anyBlk = blk as unknown as Record<string, unknown>;
      if ('binding' in blk && blk.binding) push((blk as Extract<Block, { binding: FieldBinding }>).binding);
      if (blk.type === 'table') {
        for (const c of (blk as Extract<Block, { type: 'table' }>).columns) push(c.binding);
      }
      if (blk.type === 'group') walk((blk as Extract<Block, { type: 'group' }>).blocks);
      if (blk.type === 'repeat') walk((blk as Extract<Block, { type: 'repeat' }>).itemTemplate);
      if (anyBlk.blocks && Array.isArray(anyBlk.blocks)) walk(anyBlk.blocks as Block[]);
    }
  };
  walk(blocks);
  return out;
}
