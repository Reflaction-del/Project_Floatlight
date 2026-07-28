// ============================================================
// 视觉物料生成器 · 风格反推（P2-E）
// ------------------------------------------------------------
// 由一张参考图（dataURL）反推出风格令牌的配色板。
// 实现：在离屏 canvas 上缩放取样 → 量化分桶统计主色 →
//   纸张=最亮、墨色=最暗、主色=最饱和、次要=明暗均值灰。
// 纯前端、离线可用（不依赖 AI 端点）；若日后接多模态模型，
// 可把「图 + 当前 token」丢给模型求更细的纹理/语气 patch。
// 此文件只在渲染进程（Electron renderer / 浏览器）运行，依赖 DOM canvas。
// ============================================================

import type { PaletteToken } from './types';

export interface InferResult {
  palette: Partial<PaletteToken>;
  applied: string[];
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}
/** 相对亮度 0..1（sRGB） */
function luminance(r: number, g: number, b: number): number {
  const a = [r, g, b].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}
/** 饱和度 0..1 */
function saturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  if (max === min) return 0;
  const l = (max + min) / 2;
  const d = max - min;
  return l > 0.5 ? d / (2 - max - min) : d / (max + min);
}

/** 由参考图 dataURL 反推配色板。 */
export async function inferStyleFromImage(dataUrl: string): Promise<InferResult> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = dataUrl;
  });

  const W = 64;
  const H = 64;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 canvas 上下文');
  ctx.drawImage(img, 0, 0, W, H);
  const data = ctx.getImageData(0, 0, W, H).data;

  // 量化到 4 bit/通道，统计主色桶
  const buckets = new Map<string, { r: number; g: number; b: number; n: number }>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue; // 跳过透明
    const r = data[i] >> 4;
    const g = data[i + 1] >> 4;
    const b = data[i + 2] >> 4;
    const key = `${r},${g},${b}`;
    const e = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
    e.r += data[i];
    e.g += data[i + 1];
    e.b += data[i + 2];
    e.n += 1;
    buckets.set(key, e);
  }

  const list = [...buckets.values()]
    .map((o) => {
      const R = o.r / o.n;
      const G = o.g / o.n;
      const B = o.b / o.n;
      return { r: Math.round(R), g: Math.round(G), b: Math.round(B), n: o.n, L: luminance(R, G, B), S: saturation(R, G, B) };
    })
    .sort((a, b) => b.n - a.n);

  if (list.length === 0) throw new Error('无法从图片提取颜色');

  const byLight = [...list].sort((a, b) => b.L - a.L);
  const paperC = byLight.find((c) => !(c.r > 240 && c.g > 240 && c.b > 240)) ?? byLight[0];

  const byDark = [...list].sort((a, b) => a.L - b.L);
  const inkC = byDark.find((c) => !(c.r < 16 && c.g < 16 && c.b < 16)) ?? byDark[0];

  const bySat = [...list].sort((a, b) => b.S - a.S);
  let accentC = bySat[0];
  if (accentC === paperC || accentC === inkC) accentC = bySat[1] ?? accentC;

  const paper = rgbToHex(paperC.r, paperC.g, paperC.b);
  const ink = rgbToHex(inkC.r, inkC.g, inkC.b);
  const accent = rgbToHex(accentC.r, accentC.g, accentC.b);
  const muted = rgbToHex((paperC.r + inkC.r) / 2, (paperC.g + inkC.g) / 2, (paperC.b + inkC.b) / 2);

  return {
    palette: {
      paper,
      ink,
      accent,
      muted,
      danger: '#b00020',
      warn: '#c77700',
      barcode: '#222222',
    },
    applied: [
      `配色·纸张 → ${paper}`,
      `配色·墨色 → ${ink}`,
      `配色·主色 → ${accent}`,
      `配色·次要 → ${muted}`,
    ],
  };
}
