// ============================================================
// 视觉物料生成器 · 块渲染公共辅助（P3-C）
// ------------------------------------------------------------
// 供 TemplateRenderer（React 实时预览）与 SvgRenderer（矢量导出）
// 共用的纯函数：图表/流程图数据解析、二维码矩阵、图标路径、形状路径。
// 不依赖 React / Electron，便于 SSR 与矢量导出复用。
// ============================================================

import QRCode from 'qrcode';

export interface ChartPoint {
  label: string;
  value: number;
}

/** 解析 "标签,值" 多行 CSV；空行/非法行自动跳过 */
export function parseChartData(raw: string): ChartPoint[] {
  const out: ChartPoint[] = [];
  const lines = (raw ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  for (const line of lines) {
    const [label, v] = line.split(',');
    if (!label || v === undefined) continue;
    const n = Number(v.trim());
    if (Number.isFinite(n)) out.push({ label: label.trim(), value: n });
  }
  return out;
}

/** 解析逗号分隔步骤名 */
export function parseFlowSteps(raw: string): string[] {
  return (raw ?? '')
    .split(/[,，;；]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 生成二维码布尔矩阵（true=黑模块） */
export function generateQRMatrix(value: string): boolean[][] {
  try {
    const qr = QRCode.create(value || ' ', { errorCorrectionLevel: 'M' });
    const count = qr.modules.size;
    const rows: boolean[][] = [];
    for (let y = 0; y < count; y++) {
      const row: boolean[] = [];
      for (let x = 0; x < count; x++) {
        row.push(Boolean(qr.modules.get(x, y)));
      }
      rows.push(row);
    }
    return rows;
  } catch {
    return [[true]];
  }
}

/** 把二维码矩阵转成单条 SVG path 字符串 */
export function qrMatrixToPath(matrix: boolean[][], size: number): string {
  if (matrix.length === 0) return '';
  const count = matrix.length;
  const cell = size / count;
  let d = '';
  for (let y = 0; y < count; y++) {
    for (let x = 0; x < count; x++) {
      if (matrix[y][x]) {
        d += `M${x * cell},${y * cell}h${cell}v${cell}h-${cell}z `;
      }
    }
  }
  return d;
}

/** 内置图标 SVG path（24×24 viewBox） */
export function getBuiltinIconPath(key: string): string | undefined {
  const map: Record<string, string> = {
    star: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
    heart: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
    shield: 'M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z',
    sword: 'M14.5 13.5L11 10l7.5-7.5 1.5 1.5L12.5 11.5l3.5 3.5-1.5 1.5zM3 21l6.5-2.5 2.5 2.5L3 21z',
    book: 'M18 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V4a2 2 0 00-2-2zM6 4h5v8l-2.5-1.5L6 12V4z',
    crown: 'M5 16L3 5l5 3 4-7 4 7 5-3-2 11H5zm0 3h14v2H5v-2z',
    flame: 'M13.5.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67zM11.71 19c-1.78 0-3.22-1.4-3.22-3.14 0-1.62 1.05-2.76 2.81-3.12 1.77-.36 3.6-1.21 4.62-2.58.39 1.29.59 2.65.59 4.04 0 2.65-2.15 4.8-4.8 4.8z',
    eye: 'M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z',
    check: 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
    cross: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
    'arrow-right': 'M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z',
    circle: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z',
    square: 'M3 3h18v18H3z',
    diamond: 'M12 2l10 10-10 10L2 12z',
    triangle: 'M12 2L2 22h20L12 2z',
    hexagon: 'M21 16.5l-9 5.2-9-5.2V7.5l9-5.2 9 5.2v9z',
  };
  return map[key];
}

/** 形状 → SVG path（适配 0 0 w h viewBox） */
export function getShapePath(shape: string, w: number, h: number, r = 0): string {
  switch (shape) {
    case 'rect': {
      const rr = Math.min(r, w / 2, h / 2);
      if (!rr) return `M0,0h${w}v${h}h-${w}z`;
      return `M0,${rr}a${rr},${rr} 0 0 1 ${rr},-${rr}h${w - 2 * rr}a${rr},${rr} 0 0 1 ${rr},${rr}v${h - 2 * rr}a${rr},${rr} 0 0 1 -${rr},${rr}h-${w - 2 * rr}a${rr},${rr} 0 0 1 -${rr},-${rr}z`;
    }
    case 'circle':
      return `M${w / 2},0a${w / 2},${h / 2} 0 1 1 0,${h}a${w / 2},${h / 2} 0 1 1 0,-${h}z`;
    case 'ellipse':
      return `M${w / 2},0a${w / 2},${h / 2} 0 1 1 0,${h}a${w / 2},${h / 2} 0 1 1 0,-${h}z`;
    case 'triangle':
      return `M${w / 2},0L${w},${h}H0z`;
    case 'diamond':
      return `M${w / 2},0L${w},${h / 2}L${w / 2},${h}L0,${h / 2}z`;
    case 'star': {
      const cx = w / 2, cy = h / 2;
      const outer = Math.min(w, h) / 2;
      const inner = outer * 0.4;
      let d = '';
      for (let i = 0; i < 10; i++) {
        const radius = i % 2 === 0 ? outer : inner;
        const angle = (Math.PI / 5) * i - Math.PI / 2;
        const x = cx + radius * Math.cos(angle);
        const y = cy + radius * Math.sin(angle);
        d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
      }
      return d + 'z';
    }
    case 'line':
    default:
      return `M0,${h / 2}L${w},${h / 2}`;
  }
}

/** 主色的若干变体，用于多系列/饼图分片 */
export function chartColors(base: string, count: number): string[] {
  const colors: string[] = [];
  for (let i = 0; i < count; i++) {
    colors.push(adjustColor(base, i * 12));
  }
  return colors;
}

function adjustColor(hex: string, amount: number): string {
  const clean = hex.replace('#', '');
  const r = Math.max(0, Math.min(255, parseInt(clean.substring(0, 2), 16) + amount));
  const g = Math.max(0, Math.min(255, parseInt(clean.substring(2, 4), 16) + amount));
  const b = Math.max(0, Math.min(255, parseInt(clean.substring(4, 6), 16) + amount));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}
