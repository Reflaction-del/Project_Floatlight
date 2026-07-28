// ============================================================
// 视觉物料生成器 · 独立 HTML 渲染（P0-6a）
// ------------------------------------------------------------
// 把 MaterialTemplate + RenderContext 渲染成“自包含 HTML 文档字符串”，
// 用于离屏窗口截图（PNG）与 PDF 导出。关键点：
//   - 用 react-dom/server 的 renderToStaticMarkup 复用 TemplateRenderer，
//     保证预览（React）与导出（静态 HTML）100% 视觉一致，避免双份序列化器。
//   - 纸张外壳（页眉/正文/页脚/纹理/水印/Logo）与 MaterialPreview 完全一致：
//     共用同一套类名（.mf-preview-frame / .mf-pv-*）与内联样式，
//     并把 index.css 中这些类的布局规则内联进文档，确保离屏窗口与实时预览
//     像素级一致（修复“导出效果与预览不符”）。
//   - 毫米 → CSS 像素按 96dpi（mm * 96 / 25.4），与打印/PDF 一致。
// ============================================================

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TemplateRenderer } from './TemplateRenderer';
import type { MaterialTemplate, StyleToken, TextureToken } from './types';
import type { RenderContext } from './bindings';

/** 输出页面规格（覆盖风格的版式，用于导出尺寸预设） */
export interface PageSpec {
  page: string;
  widthMm: number;
  heightMm: number;
}
export interface RenderHtmlOptions {
  page?: PageSpec;
}

const MM_TO_PX = 96 / 25.4;
const mmToPx = (mm: number) => Math.round(mm * MM_TO_PX);

/** 微小 SVG 噪点纹理（内联 dataURL，离线可用） */
const NOISE_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='90' height='90'>" +
  "<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/>" +
  "<feColorMatrix type='saturate' values='0'/></filter>" +
  "<rect width='100%' height='100%' filter='url(#n)' opacity='0.5'/></svg>";

/** 把纹理令牌转成可直接用于 background 的 CSS 字符串（'none' 返回空串） */
export function textureBackground(t: TextureToken): string {
  switch (t.key) {
    case 'none':
      return '';
    case 'grid':
      return (
        'repeating-linear-gradient(0deg, rgba(0,0,0,.05) 0 1px, transparent 1px 14px), ' +
        'repeating-linear-gradient(90deg, rgba(0,0,0,.05) 0 1px, transparent 1px 14px)'
      );
    case 'dots':
      return "radial-gradient(rgba(0,0,0,.06) 1.2px, transparent 1.3px) 0 0 / 12px 12px";
    case 'lined':
      return 'repeating-linear-gradient(0deg, transparent 0 7px, rgba(0,0,0,.05) 7px 8px)';
    case 'scanline':
      return 'repeating-linear-gradient(0deg, rgba(0,0,0,.04) 0 1px, transparent 1px 3px)';
    case 'stamp':
      return 'radial-gradient(circle at 50% 42%, rgba(0,0,0,.05), transparent 62%)';
    case 'noise':
      return `url("data:image/svg+xml,${encodeURIComponent(NOISE_SVG)}")`;
    case 'paper':
    default:
      return "radial-gradient(rgba(0,0,0,.03) 1px, transparent 1px) 0 0 / 3px 3px";
  }
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Logo 形状 → 圆角 */
function logoRadius(shape: StyleToken['logo']['shape']): string {
  switch (shape) {
    case 'circle':
    case 'ellipse':
      return '50%';
    case 'square':
      return '8px';
    case 'rect':
      return '4px';
    case 'line':
    default:
      return '0';
  }
}

function renderLogo(token: StyleToken): string {
  const src = token.logo.src.trim();
  if (!src) return '';
  const isSvg = src.startsWith('<svg');
  // 与 MaterialPreview 一致：定位在 10px / 10px（与 index.css 实时预览同源）
  const box = `position:absolute;top:10px;right:10px;z-index:3;width:${token.logo.size}px;height:${token.logo.size}px;border-radius:${logoRadius(token.logo.shape)};overflow:hidden;display:flex;align-items:center;justify-content:center;`;
  if (isSvg) return `<div class="material-logo" style="${box}">${src}</div>`;
  return `<img class="material-logo" src="${esc(src)}" style="${box}object-fit:contain;" />`;
}

/**
 * 与 MaterialPreview（实时预览）共用同一套纸张外壳 + 内联样式 + 类布局规则，
 * 确保离屏渲染（导出 PNG / PDF / 复制图）与中间预览 100% 一致。
 */
export function renderMaterialHtml(
  template: MaterialTemplate,
  ctx: RenderContext,
  opts?: RenderHtmlOptions,
): string {
  const token = ctx.token;
  const page: PageSpec =
    opts?.page ?? {
      page: token.layout.page,
      widthMm: token.layout.widthMm,
      heightMm: token.layout.heightMm,
    };

  const wPx = mmToPx(page.widthMm);
  const hPx = mmToPx(page.heightMm);

  const header = (token.layout.header ?? '{worldName}').replace(/\{worldName\}/g, ctx.worldName);
  const footer = esc(token.layout.footer ?? '');
  const watermark = token.layout.watermark?.trim() ?? '';
  const bg = template.background;
  const pageBg = esc(bg?.color ?? token.palette.paper);

  // 复用 React 渲染器 → 静态标记（与预览同一组件、同一份 props，块内容天然一致）
  const inner = renderToStaticMarkup(<TemplateRenderer template={template} ctx={ctx} />);
  const texBg = textureBackground(token.texture);

  // —— 层叠顺序与 MaterialPreview 对齐：背景图(0) < 纹理(1) < 水印(1) < 内容(2) < Logo(3) ——
  const bgImageLayer = bg?.image
    ? `<div style="position:absolute;inset:0;z-index:0;background-image:url(${esc(bg.image)});background-size:${bg.imageSize ?? 'cover'};background-position:${bg.imagePosition ?? 'center'};background-repeat:${bg.imageRepeat ?? 'no-repeat'};opacity:${bg.imageOpacity ?? 1};pointer-events:none;"></div>`
    : '';
  const texLayer = texBg
    ? `<div style="position:absolute;inset:0;z-index:1;background:${texBg};opacity:${token.texture.opacity};mix-blend-mode:${token.texture.blend};pointer-events:none;"></div>`
    : '';
  const wmLayer = watermark
    ? `<div style="position:absolute;inset:0;z-index:1;display:flex;align-items:center;justify-content:center;transform:rotate(-28deg);font-family:${token.typography.titleFont};font-size:64px;color:${token.palette.muted};opacity:.06;white-space:nowrap;overflow:hidden;pointer-events:none;">${esc(watermark)}</div>`
    : '';
  const logoLayer = renderLogo(token);

  // 与 index.css 中 .mf-preview-frame / .mf-pv-* / .mf-* 布局规则逐字一致，
  // 这样离屏窗口即使不加载 index.css，也能得到与实时预览相同的排版。
  const style = `
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; overflow: hidden; }
    body { width: ${wPx}px; height: ${hPx}px; background: ${pageBg}; }
    .mf-preview-frame {
      border-radius: 4px; overflow: hidden; display: flex; flex-direction: column; flex-shrink: 0;
    }
    .mf-pv-header {
      padding: 14px 18px; font-size: 14px; font-weight: 700; letter-spacing: .04em;
    }
    .mf-pv-body {
      padding: 18px; flex: 1; display: flex; flex-direction: column; gap: 10px;
    }
    .mf-pv-footer {
      padding: 10px 18px; font-size: 10px; letter-spacing: .1em; text-transform: uppercase; text-align: right;
    }
    /* —— 渲染器使用的块布局类（与 index.css 一致） —— */
    .mf-render { display: flex; flex-direction: column; gap: 10px; }
    .mf-b-image { overflow: hidden; flex-shrink: 0; }
    .mf-b-image img { display: block; }
    .mf-b-barcode { display: flex; flex-direction: column; gap: 2px; }
    .mf-barcode-bars { height: 34px; border-radius: 3px; background: repeating-linear-gradient(90deg, #232323 0 2px, transparent 2px 4px, #232323 4px 7px, transparent 7px 10px); }
    .mf-b-sign { display: flex; flex-direction: column; }
    .mf-b-spectrum { display: flex; align-items: center; gap: 8px; }
    .mf-b-table th, .mf-b-table td { text-align: left; vertical-align: top; }
  `;

  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8" />
<style>${style}</style>
</head>
<body>
  <div class="mf-preview-frame" style="width:${wPx}px;height:${hPx}px;background:${pageBg};color:${token.palette.ink};font-family:${token.typography.bodyFont};position:relative;">
    ${bgImageLayer}
    ${texLayer}
    ${wmLayer}
    ${logoLayer}
    <div style="position:relative;z-index:2;display:flex;flex-direction:column;flex:1;min-height:0;">
      ${header ? `<div class="mf-pv-header" style="background:${token.palette.accent};color:#fff;font-family:${token.typography.titleFont};">${esc(header)}</div>` : ''}
      <div class="mf-pv-body" style="flex:1;">${inner}</div>
      ${footer ? `<div class="mf-pv-footer" style="color:${token.palette.muted};">${footer}</div>` : ''}
    </div>
  </div>
</body>
</html>`;
}
