// ============================================================
// 视觉物料生成器 · 矢量导出（P3-B）
// ------------------------------------------------------------
// 把 MaterialTemplate + RenderContext 序列化为「自包含 SVG 文档字符串」，
// 矢量元素（文本 / 矩形 / 线条 / 图像 / 表格）可在 Inkscape / Figma
// 直接编辑，满足「矢量元素导出」需求。
// 纯函数，复用 bindings 解析层保证与 HTML 预览字段一致；不依赖 Electron。
// 布局采用简单纵向流（含 group 行/列、repeat 循环），非 1:1 像素复刻，
// 但产出合法、可编辑的矢量图。
// ============================================================

import type { MaterialTemplate, StyleToken, Block, TextBlock, ImageBlock, TableBlock, DividerBlock, IconBlock, BarcodeBlock, SignatureBlock, SpectrumBlock, GroupBlock, RepeatBlock, ShapeBlock, ChartBlock, FlowchartBlock, QRCodeBlock } from './types';
import type { RenderContext } from './bindings';
import {
  resolveBinding, interpolate, applyTone, resolveShowIf,
  resolveTableRows, resolveCell, resolveRepeatEntities,
  resolveSpectrumColor,
} from './bindings';
import {
  parseChartData, parseFlowSteps, generateQRMatrix, qrMatrixToPath,
  getBuiltinIconPath, getShapePath, chartColors,
} from './renderHelpers';

const MM_TO_PX = 96 / 25.4;
const mmToPx = (mm: number) => Math.round(mm * MM_TO_PX);

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 粗略字符宽度：CJK ≈ 字号，其余 ≈ 0.55×字号 */
function charW(ch: string, fs: number): number {
  return /[　-鿿＀-￯]/.test(ch) ? fs : fs * 0.55;
}
function textW(text: string, fs: number): number {
  let w = 0;
  for (const ch of text) w += charW(ch, fs);
  return w;
}
/** 按可用宽度断行（CJK 逐字，西文按单词） */
function wrap(text: string, fs: number, maxW: number): string[] {
  if (maxW <= 0) return [text];
  const lines: string[] = [];
  let line = '';
  let w = 0;
  const pushWord = (word: string) => {
    const ww = textW(word, fs);
    if (w + ww > maxW && line) { lines.push(line); line = word; w = ww; }
    else { line += word; w += ww; }
  };
  // 先按空格切，再对超长 token 逐字断
  for (const seg of text.split(' ')) {
    if (textW(seg, fs) <= maxW) { pushWord((line ? ' ' : '') + seg); }
    else {
      let chunk = '';
      for (const ch of seg) {
        const cw = charW(ch, fs);
        if (w + cw > maxW && (line || chunk)) {
          if (line) { lines.push(line); line = ''; w = 0; }
          lines.push(chunk); chunk = ch; w = cw;
        } else { chunk += ch; w += cw; }
      }
      if (chunk) { pushWord((line ? ' ' : '') + chunk); }
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function fontFor(role: TextBlock['role'], token: StyleToken): { family: string; size: number; weight: number; italic: boolean; fill: string } {
  const t = token.typography;
  switch (role) {
    case 'title': return { family: t.titleFont, size: t.titleSize, weight: 700, italic: false, fill: token.palette.ink };
    case 'label': return { family: t.bodyFont, size: t.labelSize, weight: 600, italic: false, fill: token.palette.muted };
    case 'value': return { family: t.bodyFont, size: t.bodySize, weight: 700, italic: false, fill: token.palette.ink };
    case 'caption': return { family: t.bodyFont, size: t.labelSize, weight: 400, italic: true, fill: token.palette.muted };
    case 'body':
    default: return { family: t.bodyFont, size: t.bodySize, weight: 400, italic: false, fill: token.palette.ink };
  }
}

interface Box { svg: string; w: number; h: number; }

/** 渲染单个 Block（含 group 行/列、repeat 循环）。x/top 为左上角，availW 为可用宽。 */
function renderBlock(b: Block, rc: RenderContext, x: number, top: number, availW: number): Box {
  const token = rc.token;
  // 条件渲染
  if (b.showIf && !resolveShowIf(b.showIf, rc)) return { svg: '', w: 0, h: 0 };

  const style = (b.style ?? {}) as Record<string, string | number>;
  const pad = (k: string) => (k in style ? ` ${k}="${esc(String(style[k]))}"` : '');

  switch (b.type) {
    case 'text': {
      const tb = b as TextBlock;
      let raw = tb.binding ? resolveBinding(tb.binding, rc) : interpolate(tb.content ?? '', rc);
      raw = applyTone(raw, token);
      if (!raw) return { svg: '', w: 0, h: 0 };
      const f = fontFor(tb.role, token);
      const lines = wrap(raw, f.size, availW);
      const lh = f.size * 1.5;
      const h = lines.length * lh;
      const svg = lines
        .map((ln, i) => `<text x="${x}" y="${top + f.size + i * lh}" font-family="${esc(f.family)}" font-size="${f.size}" font-weight="${f.weight}" font-style="${f.italic ? 'italic' : 'normal'}" fill="${esc(f.fill)}">${esc(ln)}</text>`)
        .join('');
      return { svg, w: availW, h };
    }
    case 'image': {
      const ib = b as ImageBlock;
      const w = ib.width ?? 96;
      const h = ib.height ?? 120;
      const src = resolveBinding(ib.binding, rc) || '';
      const round = ib.round ? ` rx="${Math.min(w, h) / 2}" ry="${Math.min(w, h) / 2}"` : '';
      const imgSvg = src.startsWith('data:')
        ? `<clipPath id="clip-${ib.id}"><rect x="${x}" y="${top}" width="${w}" height="${h}"${round} /></clipPath><image href="${esc(src)}" x="${x}" y="${top}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#clip-${ib.id})" />`
        : `<rect x="${x}" y="${top}" width="${w}" height="${h}"${round} fill="#e9e9e9" stroke="#bbb" />`;
      return { svg: imgSvg, w, h };
    }
    case 'divider': {
      const h = 10;
      return {
        svg: `<line x1="${x}" y1="${top + h / 2}" x2="${x + availW}" y2="${top + h / 2}" stroke="${esc(token.palette.muted)}" stroke-width="1" opacity="0.5" />`,
        w: availW, h,
      };
    }
    case 'table': {
      const tb = b as TableBlock;
      const rows = resolveTableRows(tb, rc);
      const cw = availW / tb.columns.length;
      const lh = token.typography.bodySize * 1.5;
      let y = top;
      let svg = `<rect x="${x}" y="${y}" width="${availW}" height="${rows.length * lh + 8}" fill="none" stroke="${esc(token.palette.muted)}" stroke-width="1" opacity="0.6" />`;
      rows.forEach((row, ri) => {
        const ry = y + 4 + ri * lh;
        tb.columns.forEach((col, ci) => {
          const cx = x + ci * cw + 4;
          const val = resolveCell(col.binding, rc, row);
          const lines = wrap(val, token.typography.bodySize, cw - 8);
          lines.slice(0, 2).forEach((ln, li) => {
            svg += `<text x="${cx}" y="${ry + token.typography.bodySize + li * lh}" font-family="${esc(token.typography.bodyFont)}" font-size="${token.typography.bodySize}" fill="${esc(token.palette.ink)}">${esc(ln)}</text>`;
          });
        });
        if (ri < rows.length - 1) svg += `<line x1="${x}" y1="${ry + lh}" x2="${x + availW}" y2="${ry + lh}" stroke="${esc(token.palette.muted)}" stroke-width="0.5" opacity="0.4" />`;
      });
      return { svg, w: availW, h: rows.length * lh + 8 };
    }
    case 'barcode': {
      const bb = b as BarcodeBlock;
      const code = resolveBinding(bb.binding, rc) || '000000';
      const h = 46;
      let bars = '';
      let bx = x;
      const unit = Math.max(2, Math.min(8, Math.floor(availW / (code.length * 4))));
      for (let i = 0; i < code.length; i++) {
        const n = code.charCodeAt(i);
        for (let b2 = 0; b2 < 4; b2++) {
          if ((n >> b2) & 1) bars += `<rect x="${bx}" y="${top + 6}" width="${unit}" height="${h - 18}" fill="${esc(token.palette.barcode ?? '#222')}" />`;
          bx += unit;
        }
      }
      const svg = bars + `<text x="${x}" y="${top + h - 2}" font-family="${esc(token.typography.monoFont)}" font-size="10" fill="${esc(token.palette.ink)}">${esc(code)}</text>`;
      return { svg, w: availW, h };
    }
    case 'signature': {
      const sb = b as SignatureBlock;
      const label = sb.label ? `<text x="${x}" y="${top + 30}" font-family="${esc(token.typography.bodyFont)}" font-size="${token.typography.labelSize}" fill="${esc(token.palette.muted)}">${esc(sb.label)}</text>` : '';
      const val = sb.binding ? resolveBinding(sb.binding, rc) : '';
      const mode = token.signature.mode || 'auto';
      const imageSrc = token.signature.imageSrc?.trim();
      const imgH = token.signature.imageHeight ?? 40;

      if (mode === 'image' || (mode === 'auto' && imageSrc)) {
        if (imageSrc && !imageSrc.startsWith('<svg')) {
          return { svg: label + `<image x="${x}" y="${top}" height="${imgH}" href="${esc(imageSrc)}" />`, w: Math.min(availW, 140), h: imgH + 4 };
        }
        // SVG 套 SVG 或 dataURL 图片缺失时退化为文字
      }
      const svg = `<line x1="${x}" y1="${top + 24}" x2="${x + Math.min(availW, 140)}" y2="${top + 24}" stroke="${esc(token.palette.ink)}" stroke-width="1" opacity="0.5" />${label}` +
        (val ? `<text x="${x}" y="${top + 20}" font-family="${esc(token.signature.font)}" font-size="16" font-style="${token.signature.italic ? 'italic' : 'normal'}" fill="${esc(token.signature.color)}">${esc(val)}</text>` : '');
      return { svg, w: Math.min(availW, 140), h: 34 };
    }
    case 'spectrum': {
      const sp = b as SpectrumBlock;
      const color = resolveSpectrumColor(sp, rc) || token.palette.accent;
      const w = 120; const h = 14;
      return { svg: `<rect x="${x}" y="${top}" width="${w}" height="${h}" rx="3" fill="${esc(color)}" />`, w, h };
    }
    case 'icon': {
      const ic = b as IconBlock;
      const s = ic.size ?? 20;
      const fill = ic.color ?? token.palette.accent;
      const path = getBuiltinIconPath(ic.iconKey) ?? getBuiltinIconPath('star')!;
      const rotate = ic.rotate ? `rotate(${ic.rotate} ${s / 2} ${s / 2})` : '';
      return { svg: `<g transform="translate(${x},${top}) ${rotate} scale(${s / 24})"><path d="${esc(path)}" fill="${esc(fill)}" /></g>`, w: s, h: s };
    }

    case 'shape': {
      const sb = b as ShapeBlock;
      const w = sb.width ?? 80;
      const h = sb.height ?? 40;
      const fill = sb.fill ?? token.palette.accent;
      const stroke = sb.stroke ?? token.palette.ink;
      const sw = sb.strokeWidth ?? 0;
      const d = getShapePath(sb.shape, w, h, sb.borderRadius ?? 0);
      const transform = sb.rotation ? ` transform="rotate(${sb.rotation} ${x + w / 2} ${top + h / 2})"` : '';
      const fillAttr = sb.shape === 'line' ? 'fill="none"' : `fill="${esc(fill)}"`;
      const svg = `<path ${fillAttr} stroke="${esc(stroke)}" stroke-width="${sb.shape === 'line' ? (sw || 2) : sw}" d="${esc(d)}"${transform} />`;
      return { svg, w, h };
    }

    case 'chart': {
      const cb = b as ChartBlock;
      const raw = cb.binding ? resolveBinding(cb.binding, rc) : '';
      const data = parseChartData(raw || cb.staticData || '');
      if (data.length === 0) return { svg: '', w: 0, h: 0 };
      const W = cb.width ?? 260;
      const H = cb.height ?? 160;
      const pad = { top: 10, right: 10, bottom: 24, left: 32 };
      const cw = W - pad.left - pad.right;
      const ch = H - pad.top - pad.bottom;
      const max = Math.max(...data.map((d) => d.value), 1);
      const colors = chartColors(cb.color ?? token.palette.accent, data.length);
      const labelColor = token.palette.muted;
      const fontSize = 10;
      let svg = `<rect x="${x}" y="${top}" width="${W}" height="${H}" fill="none" />`;

      if (cb.kind === 'pie' || cb.kind === 'donut') {
        const total = data.reduce((a, d) => a + d.value, 0) || 1;
        const radius = Math.min(cw, ch) / 2;
        const cx = x + W / 2;
        const cy = top + H / 2;
        let start = -Math.PI / 2;
        for (let i = 0; i < data.length; i++) {
          const d = data[i];
          const angle = (d.value / total) * Math.PI * 2;
          const end = start + angle;
          const x1 = cx + radius * Math.cos(start);
          const y1 = cy + radius * Math.sin(start);
          const x2 = cx + radius * Math.cos(end);
          const y2 = cy + radius * Math.sin(end);
          const large = angle > Math.PI ? 1 : 0;
          const path = `M${cx},${cy}L${x1},${y1}A${radius},${radius} 0 ${large},1 ${x2},${y2}Z`;
          const mid = start + angle / 2;
          const lr = radius * 0.65;
          const lx = cx + lr * Math.cos(mid);
          const ly = cy + lr * Math.sin(mid);
          svg += `<path d="${path}" fill="${esc(colors[i])}" stroke="#fff" stroke-width="1" />`;
          svg += `<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle" font-size="${fontSize}" fill="${esc(labelColor)}">${esc(d.label)}</text>`;
          start = end;
        }
        if (cb.kind === 'donut') {
          svg += `<circle cx="${cx}" cy="${cy}" r="${radius * 0.55}" fill="${esc(token.palette.paper)}" />`;
        }
        return { svg, w: W, h: H };
      }

      if (cb.kind === 'radar') {
        const cx = x + W / 2;
        const cy = top + H / 2;
        const radius = Math.min(W, H) / 2 - 34;
        const levels = 4;
        const angleStep = (Math.PI * 2) / data.length;
        const maxVal = Math.max(...data.map((d) => d.value), 1);

        for (let lv = 1; lv <= levels; lv++) {
          const r = (radius * lv) / levels;
          const pts = data.map((_, i) => {
            const angle = -Math.PI / 2 + i * angleStep;
            return `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`;
          }).join(' ');
          svg += `<polygon points="${pts}" fill="none" stroke="${esc(labelColor)}" stroke-width="0.5" opacity="0.5" />`;
        }

        for (let i = 0; i < data.length; i++) {
          const angle = -Math.PI / 2 + i * angleStep;
          const x2 = cx + radius * Math.cos(angle);
          const y2 = cy + radius * Math.sin(angle);
          svg += `<line x1="${cx}" y1="${cy}" x2="${x2}" y2="${y2}" stroke="${esc(labelColor)}" stroke-width="0.5" opacity="0.5" />`;
        }

        const pts = data.map((d, i) => {
          const angle = -Math.PI / 2 + i * angleStep;
          const r = (d.value / maxVal) * radius;
          return `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`;
        }).join(' ');
        const mainColor = esc(cb.color ?? token.palette.accent);
        svg += `<polygon points="${pts}" fill="${mainColor}40" stroke="${mainColor}" stroke-width="2" />`;

        for (let i = 0; i < data.length; i++) {
          const angle = -Math.PI / 2 + i * angleStep;
          const r = (data[i].value / maxVal) * radius;
          const px = cx + r * Math.cos(angle);
          const py = cy + r * Math.sin(angle);
          svg += `<circle cx="${px}" cy="${py}" r="3" fill="${esc(colors[i])}" />`;
        }

        for (let i = 0; i < data.length; i++) {
          const angle = -Math.PI / 2 + i * angleStep;
          const lx = cx + (radius + 16) * Math.cos(angle);
          const ly = cy + (radius + 16) * Math.sin(angle);
          svg += `<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle" font-size="${fontSize}" fill="${esc(labelColor)}">${esc(data[i].label)}</text>`;
        }

        return { svg, w: W, h: H };
      }

      // 坐标轴
      svg += `<line x1="${x + pad.left}" y1="${top + pad.top}" x2="${x + pad.left}" y2="${top + H - pad.bottom}" stroke="${esc(labelColor)}" stroke-width="1" />`;
      svg += `<line x1="${x + pad.left}" y1="${top + H - pad.bottom}" x2="${x + W - pad.right}" y2="${top + H - pad.bottom}" stroke="${esc(labelColor)}" stroke-width="1" />`;
      svg += `<text x="${x + pad.left - 4}" y="${top + H - pad.bottom}" text-anchor="end" dominant-baseline="middle" font-size="${fontSize}" fill="${esc(labelColor)}">0</text>`;
      svg += `<text x="${x + pad.left - 4}" y="${top + pad.top + 4}" text-anchor="end" dominant-baseline="middle" font-size="${fontSize}" fill="${esc(labelColor)}">${max}</text>`;

      if (cb.kind === 'bar') {
        const barW = cw / data.length * 0.6;
        for (let i = 0; i < data.length; i++) {
          const d = data[i];
          const bh = (d.value / max) * ch;
          const bx = x + pad.left + (cw / data.length) * i + (cw / data.length - barW) / 2;
          const by = top + H - pad.bottom - bh;
          svg += `<rect x="${bx}" y="${by}" width="${barW}" height="${bh}" fill="${esc(colors[i])}" rx="2" />`;
          svg += `<text x="${bx + barW / 2}" y="${top + H - pad.bottom + 12}" text-anchor="middle" font-size="${fontSize}" fill="${esc(labelColor)}">${esc(d.label)}</text>`;
        }
      } else if (cb.kind === 'line') {
        const step = data.length > 1 ? cw / (data.length - 1) : cw;
        const points = data.map((d, i) => {
          const px = x + pad.left + step * i;
          const py = top + H - pad.bottom - (d.value / max) * ch;
          return `${px},${py}`;
        }).join(' ');
        svg += `<polyline fill="none" stroke="${esc(cb.color ?? token.palette.accent)}" stroke-width="2" points="${points}" />`;
        for (let i = 0; i < data.length; i++) {
          const d = data[i];
          const px = x + pad.left + step * i;
          const py = top + H - pad.bottom - (d.value / max) * ch;
          svg += `<circle cx="${px}" cy="${py}" r="3" fill="${esc(colors[i])}" />`;
          svg += `<text x="${px}" y="${top + H - pad.bottom + 12}" text-anchor="middle" font-size="${fontSize}" fill="${esc(labelColor)}">${esc(d.label)}</text>`;
        }
      }
      return { svg, w: W, h: H };
    }

    case 'flowchart': {
      const fb = b as FlowchartBlock;
      const raw = fb.binding ? resolveBinding(fb.binding, rc) : '';
      const steps = parseFlowSteps(raw || fb.staticSteps || '');
      if (steps.length === 0) return { svg: '', w: 0, h: 0 };
      const isRow = fb.direction !== 'col';
      const boxW = 80;
      const boxH = 36;
      const gap = 24;
      const W = isRow ? steps.length * boxW + (steps.length - 1) * gap + 16 : boxW + 16;
      const H = isRow ? boxH + 16 : steps.length * boxH + (steps.length - 1) * gap + 16;
      const stepColor = fb.stepColor ?? token.palette.accent;
      const arrowColor = fb.arrowColor ?? token.palette.muted;
      let svg = '';
      for (let i = 0; i < steps.length; i++) {
        const bx = isRow ? x + 8 + i * (boxW + gap) : x + (W - boxW) / 2;
        const by = isRow ? top + (H - boxH) / 2 : top + 8 + i * (boxH + gap);
        svg += `<rect x="${bx}" y="${by}" width="${boxW}" height="${boxH}" rx="6" fill="${esc(stepColor)}" />`;
        svg += `<text x="${bx + boxW / 2}" y="${by + boxH / 2}" text-anchor="middle" dominant-baseline="middle" font-size="11" fill="#fff">${esc(steps[i])}</text>`;
        if (i < steps.length - 1) {
          if (isRow) {
            const ax = bx + boxW;
            const ay = by + boxH / 2;
            svg += `<path d="M${ax},${ay}L${ax + gap - 6},${ay}M${ax + gap - 10},${ay - 4}L${ax + gap - 6},${ay}L${ax + gap - 10},${ay + 4}" stroke="${esc(arrowColor)}" stroke-width="1.5" fill="none" />`;
          } else {
            const ax = bx + boxW / 2;
            const ay = by + boxH;
            svg += `<path d="M${ax},${ay}L${ax},${ay + gap - 6}M${ax - 4},${ay + gap - 10}L${ax},${ay + gap - 6}L${ax + 4},${ay + gap - 10}" stroke="${esc(arrowColor)}" stroke-width="1.5" fill="none" />`;
          }
        }
      }
      return { svg, w: W, h: H };
    }

    case 'qrcode': {
      const qb = b as QRCodeBlock;
      const raw = qb.binding ? resolveBinding(qb.binding, rc) : '';
      const value = raw || qb.staticValue || ' ';
      const size = qb.size ?? 120;
      const color = qb.color ?? '#1a1a1a';
      const bg = qb.bgColor ?? '#ffffff';
      const matrix = generateQRMatrix(value);
      const path = qrMatrixToPath(matrix, size);
      const svg = `<rect x="${x}" y="${top}" width="${size}" height="${size}" fill="${esc(bg)}" /><path d="${path}" fill="${esc(color)}" transform="translate(${x},${top})" />`;
      return { svg, w: size, h: size };
    }

    case 'group': {
      const gb = b as GroupBlock;
      const gap = Number(style.gap ?? 12);
      if (gb.direction === 'row') {
        let cx = x;
        let maxH = 0;
        let svg = '';
        for (const child of gb.blocks) {
          const box = renderBlock(child, rc, cx, top, availW - (cx - x));
          svg += box.svg;
          cx += box.w + gap;
          maxH = Math.max(maxH, box.h);
        }
        return { svg, w: Math.min(availW, cx - x - gap), h: maxH };
      }
      // 列：纵向堆叠
      let cy = top;
      let svg = '';
      let maxW = 0;
      for (const child of gb.blocks) {
        const box = renderBlock(child, rc, x, cy, availW);
        svg += box.svg;
        cy += box.h + gap;
        maxW = Math.max(maxW, box.w);
      }
      return { svg, w: maxW, h: cy - top - gap };
    }
    case 'repeat': {
      const rb = b as RepeatBlock;
      const found = resolveRepeatEntities(rb, rc);
      let cy = top;
      let svg = '';
      let maxW = 0;
      for (const ent of found) {
        const sub: RenderContext = { ...rc, entity: ent };
        for (const blk of rb.itemTemplate) {
          const box = renderBlock(blk, sub, x, cy, availW);
          svg += box.svg;
          cy += box.h + 10;
          maxW = Math.max(maxW, box.w);
        }
      }
      return { svg, w: maxW, h: Math.max(0, cy - top - 10) };
    }
    case 'slot':
    default:
      return { svg: '', w: 0, h: 0 };
  }
}

export interface SvgOptions { page?: { page: string; widthMm: number; heightMm: number } }

/** 生成完整、自包含的 SVG 文档字符串（矢量元素可编辑）。 */
export function renderMaterialSvg(
  template: MaterialTemplate,
  rc: RenderContext,
  opts?: SvgOptions,
): string {
  const token = rc.token;
  const page = opts?.page ?? {
    page: token.layout.page,
    widthMm: token.layout.widthMm,
    heightMm: token.layout.heightMm,
  };
  const wPx = mmToPx(page.widthMm);
  const hPx = mmToPx(page.heightMm);
  const pad = mmToPx(token.layout.paddingMm);
  const contentW = wPx - pad * 2;
  const bg = template.background;
  const pageBg = esc(bg?.color ?? token.palette.paper);

  const headerText = (token.layout.header ?? '{worldName}').replace(/\{worldName\}/g, rc.worldName);
  const footerText = token.layout.footer ?? '';

  // 页眉条
  const headerH = 34;
  let body = '';
  if (headerText) {
    body += `<rect x="0" y="0" width="${wPx}" height="${headerH}" fill="${esc(token.palette.accent)}" />`;
    body += `<text x="${pad}" y="${headerH - 10}" font-family="${esc(token.typography.titleFont)}" font-size="${Math.max(13, Math.round(token.typography.titleSize * 0.7))}" font-weight="700" fill="#ffffff">${esc(headerText)}</text>`;
  }
  // 页脚
  if (footerText) {
    body += `<text x="${wPx - pad}" y="${hPx - pad / 2}" text-anchor="end" font-family="${esc(token.typography.bodyFont)}" font-size="10" letter-spacing="1.4" fill="${esc(token.palette.muted)}">${esc(footerText.toUpperCase())}</text>`;
  }
  // Logo（仅 dataURL 可嵌入矢量；inline svg 占位）
  const logoSrc = token.logo.src.trim();
  if (logoSrc.startsWith('data:')) {
    const ls = token.logo.size;
    body += `<clipPath id="logo-clip"><rect x="${wPx - pad - ls}" y="${pad}" width="${ls}" height="${ls}" rx="6" /></clipPath><image href="${esc(logoSrc)}" x="${wPx - pad - ls}" y="${pad}" width="${ls}" height="${ls}" preserveAspectRatio="xMidYMid slice" clip-path="url(#logo-clip)" />`;
  }
  // 水印
  const watermark = token.layout.watermark?.trim();
  if (watermark) {
    body += `<text x="${wPx / 2}" y="${hPx / 2}" text-anchor="middle" transform="rotate(-28 ${wPx / 2} ${hPx / 2})" font-family="${esc(token.typography.titleFont)}" font-size="${Math.round(hPx * 0.32)}" fill="${esc(token.palette.muted)}" opacity="0.06">${esc(watermark)}</text>`;
  }

  // 纵向流渲染主体
  let y = pad + (headerText ? headerH + 10 : 0);
  for (const blk of template.blocks) {
    const box = renderBlock(blk, rc, pad, y, contentW);
    body += box.svg;
    y += box.h + 10;
  }

  const bgImage = bg?.image
    ? `<image href="${esc(bg.image)}" x="0" y="0" width="${wPx}" height="${hPx}" preserveAspectRatio="${(bg.imageSize === 'contain' ? 'xMidYMid meet' : bg.imageSize === 'auto' ? 'xMidYMid' : 'xMidYMid slice')}" opacity="${bg.imageOpacity ?? 1}" />`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${wPx}" height="${hPx}" viewBox="0 0 ${wPx} ${hPx}">
  <rect x="0" y="0" width="${wPx}" height="${hPx}" fill="${pageBg}" />
  ${bgImage}
  ${body}
</svg>`;
}
