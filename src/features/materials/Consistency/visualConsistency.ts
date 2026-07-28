// ============================================================
// 视觉物料生成器 · 视觉一致性校验（P1-C）
// ------------------------------------------------------------
// 纯函数，校验两类漂移：
//   1) 风格令牌自身有效性 / 对比度漂移（配色、字体、Logo、页眉）
//   2) 实体数据对模板的就绪度 + 跨图唯一性（头像缺失、缺字段、
//      编号/证件号在多个角色间碰撞）
// 并产出资产引用计数（Logo 被多少物料引用、头像覆盖率）。
// ============================================================

import type { MaterialStyle, PortraitMode, StyleToken, TextureKey } from '../types';
import { resolveBinding, type RenderContext } from '../bindings';
import { createDefaultStyleToken } from '../types';
import type { WikiEntity } from '../../../types';

export type IssueSeverity = 'error' | 'warn' | 'info';
export type IssueScope = 'style' | 'entity' | 'asset';

export interface MaterialIssue {
  id: string;
  severity: IssueSeverity;
  scope: IssueScope;
  targetId?: string;
  targetName?: string;
  message: string;
  hint?: string;
}

export interface AssetReport {
  logos: { styleId: string; name: string; hasLogo: boolean; referencedBy: number }[];
  portraits: { entityId: string; name: string; mode: PortraitMode; hasSource: boolean }[];
}

/** 模板 → 字段就绪要求 */
export interface TemplateRequirement {
  portrait: boolean;
  fields: string[]; // 需要的 customField key（缺则显示回退值）
  unique: string[]; // 需要跨图唯一的编号类字段 key
}
export const TEMPLATE_REQUIREMENTS: Record<string, TemplateRequirement> = {
  staffFile: { portrait: true, fields: ['serial', 'signature'], unique: ['serial'] },
  idCard: { portrait: true, fields: ['id', 'signature'], unique: ['id'] },
  menu: { portrait: false, fields: [], unique: [] },
};

/* ---------- 颜色工具 ---------- */
const CSS_COLOR_RE =
  /^(#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})|rgba?\([^)]*\)|hsla?\([^)]*\))$/i;
export function isCssColor(s: string): boolean {
  return CSS_COLOR_RE.test((s || '').trim());
}

function hexToRgb(hex: string): [number, number, number] | null {
  const h = (hex || '').trim().replace('#', '');
  let r = 0,
    g = 0,
    b = 0;
  if (h.length === 3) {
    r = parseInt(h[0] + h[0], 16);
    g = parseInt(h[1] + h[1], 16);
    b = parseInt(h[2] + h[2], 16);
  } else if (h.length === 6 || h.length === 8) {
    r = parseInt(h.slice(0, 2), 16);
    g = parseInt(h.slice(2, 4), 16);
    b = parseInt(h.slice(4, 6), 16);
  } else {
    return null;
  }
  return [r, g, b];
}
function relLuminance(c: string): number {
  const rgb = hexToRgb(c);
  if (!rgb) return 1;
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const la = relLuminance(a);
  const lb = relLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/* ---------- 头像是否可用（三模式取源） ---------- */
function hasPortrait(e: WikiEntity | null, mode: PortraitMode): boolean {
  if (!e) return false;
  const p = e.portrait;
  if (mode === 'upload') return !!p?.uploadSrc;
  if (mode === 'ai') return !!p?.aiSrc;
  const id = p?.imageId ?? e.coverImageId;
  const img = e.images?.find((i) => i.id === id) ?? e.images?.[0];
  return !!img?.dataUrl;
}

/* ---------- 单风格校验 ---------- */
export function checkStyle(style: MaterialStyle): MaterialIssue[] {
  const out: MaterialIssue[] = [];
  const t: StyleToken = style.token;
  const tag = (mid: string, msg: string, sev: IssueSeverity, hint?: string) =>
    out.push({ id: `style-${style.id}-${mid}`, severity: sev, scope: 'style', targetId: style.id, targetName: style.name, message: msg, hint });

  // 配色有效性
  const pal = t.palette;
  for (const k of ['paper', 'ink', 'accent', 'muted', 'danger', 'warn'] as const) {
    const v = (pal as any)[k] as string;
    if (!isCssColor(v)) tag(`pal-${k}`, `配色「${k}」不是合法颜色：${v}`, 'error');
  }
  // 对比度漂移
  if (isCssColor(pal.ink) && isCssColor(pal.paper)) {
    const c = contrast(pal.ink, pal.paper);
    if (c < 3) tag('contrast-ink', `正文色与纸张对比度偏低（${c.toFixed(2)}:1），可读性风险`, 'warn', '建议加深墨色或减淡纸张');
  }
  if (isCssColor(pal.accent) && isCssColor(pal.paper)) {
    const c = contrast(pal.accent, pal.paper);
    if (c < 1.6) tag('contrast-accent', `主色与纸张过于接近（${c.toFixed(2)}:1），物料不够醒目`, 'warn', '主色建议与纸张形成明显反差');
  }
  // 字体
  for (const k of ['titleFont', 'bodyFont', 'monoFont'] as const) {
    if (!(t.typography as any)[k]) tag(`font-${k}`, `字体「${k}」为空`, 'error');
  }
  // Logo
  if (!t.logo.src.trim()) tag('logo', '未设置主 Logo（菜单 / 证件模板将显示占位框）', 'warn');
  // 页眉页脚
  if (!t.layout.header?.trim() && !t.layout.footer?.trim()) {
    tag('header-footer', '页眉与页脚均为空，物料缺少机构标识', 'info');
  }
  // 纹理参数
  const validTex: TextureKey[] = ['none', 'grid', 'paper', 'scanline', 'noise', 'dots', 'lined', 'stamp'];
  if (!validTex.includes(t.texture.key)) tag('tex-key', `纹理类型非法：${t.texture.key}`, 'error');
  if (typeof t.texture.opacity !== 'number' || t.texture.opacity < 0 || t.texture.opacity > 1) {
    tag('tex-op', `纹理不透明度超出 0-1 范围：${t.texture.opacity}`, 'warn');
  }
  return out;
}

/* ---------- 按模板模拟解析，校验实体就绪度 + 跨图唯一 ---------- */
export function scanMaterialConsistency(params: {
  entities: WikiEntity[];
  styles: MaterialStyle[];
  template: string;
  portraitMode: PortraitMode;
  worldName: string;
}): { issues: MaterialIssue[]; assetReport: AssetReport } {
  const { entities, styles, template, portraitMode, worldName } = params;
  const issues: MaterialIssue[] = [];
  const dummy = createDefaultStyleToken();

  // 1) 风格层面
  for (const s of styles) issues.push(...checkStyle(s));

  // 2) 实体层面（针对所选模板）
  const req = TEMPLATE_REQUIREMENTS[template] ?? { portrait: false, fields: [], unique: [] };
  const uniqueBuckets: Record<string, string[]> = {};
  for (const k of req.unique) uniqueBuckets[k] = [];

  for (const e of entities) {
    const ctx: RenderContext = {
      entity: e,
      worldName,
      token: dummy,
      portraitMode,
      useAI: false,
      allEntities: entities,
    };
    // 头像
    if (req.portrait && !hasPortrait(e, portraitMode)) {
      issues.push({
        id: `ent-${e.id}-portrait`,
        severity: 'warn',
        scope: 'entity',
        targetId: e.id,
        targetName: e.name,
        message: `「${e.name}」缺少头像（${portraitMode} 模式下无可用来源）`,
        hint: '可在属性面板用实体插图 / 上传 / AI 生成补全',
      });
    }
    // 必填字段
    for (const key of req.fields) {
      const v = resolveBinding({ source: 'customField', path: key, fallback: '' }, ctx);
      if (!v.trim()) {
        issues.push({
          id: `ent-${e.id}-cf-${key}`,
          severity: 'warn',
          scope: 'entity',
          targetId: e.id,
          targetName: e.name,
          message: `「${e.name}」缺少字段「${key}」（将显示回退值）`,
          hint: `在实体库 materialFields 中补充 key=${key}`,
        });
      }
    }
    // 跨图唯一性收集
    for (const k of req.unique) {
      const v = resolveBinding({ source: 'customField', path: k, fallback: '' }, ctx);
      uniqueBuckets[k].push(v.trim() || `⟨空⟩-${e.id}`);
    }
  }

  // 唯一性碰撞（含回退值 SUBJ-0000 / ID-000000 的互相碰撞）
  for (const k of req.unique) {
    const counts = new Map<string, string[]>();
    for (const v of uniqueBuckets[k]) {
      const arr = counts.get(v) ?? [];
      arr.push(v);
      counts.set(v, arr);
    }
    for (const [val, arr] of counts) {
      if (arr.length > 1) {
        issues.push({
          id: `unique-${template}-${k}-${val}`,
          severity: 'error',
          scope: 'asset',
          message: `字段「${k}」取值「${val}」在 ${arr.length} 个角色间重复，跨图物料将互相混淆`,
          hint: '为每个角色配置唯一编号',
        });
      }
    }
  }

  // 3) 资产引用计数
  const assetReport: AssetReport = {
    logos: styles.map((s) => ({
      styleId: s.id,
      name: s.name,
      hasLogo: !!s.token.logo.src.trim(),
      referencedBy: entities.length,
    })),
    portraits: entities.map((e) => ({
      entityId: e.id,
      name: e.name,
      mode: portraitMode,
      hasSource: hasPortrait(e, portraitMode),
    })),
  };

  return { issues, assetReport };
}
