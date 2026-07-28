// ============================================================
// 视觉物料生成器 · 自然语言改风格（P2-C）
// ------------------------------------------------------------
// 把一句中文/英文指令解析成对 StyleToken 的局部修改，支撑
// 用户决策 #3：「让用户通过 Copilot / 自然语言调整风格」。
// 纯函数、离线可用（不依赖 AI）：用规则 + 关键词 + 颜色名表。
// 若后续接 AI，可把「当前 token JSON + 指令」丢给模型求 patch，
// 再用本解析器兜底（模型返回非预期时仍可部分生效）。
// ============================================================

import type { StyleToken, ToneRegister, TextureKey, PageKind } from './types';

/** 中文色名 → hex（覆盖常见美术诉求） */
const NAMED_COLORS: Record<string, string> = {
  '红': '#c0392b', '红色': '#c0392b',
  '蓝': '#1f3a5f', '蓝色': '#1f3a5f', '深蓝': '#0b2545',
  '绿': '#2e7d32', '绿色': '#2e7d32',
  '黑': '#1a1a1a', '黑底': '#111111', '墨': '#1a1a1a',
  '白': '#f5f3ec', '米白': '#f5f3ec', '米色': '#f5f3ec',
  '橙': '#c77700', '橙黄': '#c77700',
  '紫': '#5b2c6f', '金': '#b8860b', '灰': '#6b6b6b',
  '青': '#1abc9c', '粉': '#d6336c', '黄': '#caa400',
};

/** 字体关键词 → CSS font-family */
const FONT_FAMILIES: Record<string, string> = {
  '宋体': '"Noto Serif SC", "Songti SC", serif',
  '衬线': '"Noto Serif SC", "Songti SC", serif',
  'serif': '"Noto Serif SC", "Songti SC", serif',
  '黑体': '"Noto Sans SC", "PingFang SC", sans-serif',
  '无衬线': '"Noto Sans SC", "PingFang SC", sans-serif',
  'sans': '"Noto Sans SC", "PingFang SC", sans-serif',
  '楷体': '"Ma Shan Zheng", cursive',
  'cursive': '"Caveat", cursive',
  'mono': '"JetBrains Mono", "Courier New", monospace',
  '等宽': '"JetBrains Mono", "Courier New", monospace',
};

const REGISTERS: { kw: string[]; v: ToneRegister }[] = [
  { kw: ['正式', '公文', '严肃', '克制'], v: 'formal' },
  { kw: ['俏皮', '活泼', '轻松'], v: 'playful' },
  { kw: ['冷峻', '冷', '疏离', '压抑'], v: 'cold' },
  { kw: ['荒诞', '黑色幽默', '戏谑'], v: 'absurd' },
];

const TEXTURES: { kw: string[]; v: TextureKey }[] = [
  { kw: ['网格', 'grid'], v: 'grid' },
  { kw: ['纸纹', 'paper'], v: 'paper' },
  { kw: ['扫描线', 'scanline'], v: 'scanline' },
  { kw: ['噪点', 'noise'], v: 'noise' },
  { kw: ['点阵', 'dots'], v: 'dots' },
  { kw: ['横线', 'lined'], v: 'lined' },
  { kw: ['印章', 'stamp'], v: 'stamp' },
  { kw: ['无纹理', '无'], v: 'none' },
];

const PAGES: { kw: string[]; v: PageKind }[] = [
  { kw: ['a4', 'A4'], v: 'A4' },
  { kw: ['a5', 'A5'], v: 'A5' },
  { kw: ['a6', 'A6'], v: 'A6' },
  { kw: ['方形', 'square'], v: 'square' },
  { kw: ['证件', 'id_card', 'id卡'], v: 'id_card' },
  { kw: ['海报', 'poster'], v: 'poster' },
];

function extractHex(s: string): string | null {
  const m = s.match(/#[0-9a-fA-F]{3,8}\b/);
  return m ? m[0] : null;
}
function extractNamedColor(s: string): string | null {
  for (const k of Object.keys(NAMED_COLORS)) {
    if (s.includes(k)) return NAMED_COLORS[k];
  }
  return null;
}

export interface StyleIntentResult {
  token: StyleToken;
  applied: string[]; // 人类可读的改动摘要
}

/** 把自然语言指令应用到基准令牌，返回新令牌 + 改动摘要。
 *  指令按标点 / 顿号拆成子句，逐句匹配可识别的意图。 */
export function applyStyleIntent(intent: string, base: StyleToken): StyleIntentResult {
  const token: StyleToken = JSON.parse(JSON.stringify(base));
  const applied: string[] = [];
  const clauses = intent
    .split(/[，。；;、\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const clause of clauses) {
    // —— 配色 ——
    const colorTargets: { kw: string[]; label: string; set: (c: string) => void }[] = [
      { kw: ['主色', '强调', '机构色', 'accent'], label: '主色', set: (c) => { token.palette.accent = c; } },
      { kw: ['纸张', '底色', '背景', 'paper'], label: '纸张', set: (c) => { token.palette.paper = c; } },
      { kw: ['文字', '墨色', 'ink'], label: '文字', set: (c) => { token.palette.ink = c; } },
      { kw: ['次要', '辅助', 'muted'], label: '次要', set: (c) => { token.palette.muted = c; } },
      { kw: ['警示', '危险', 'danger'], label: '警示', set: (c) => { token.palette.danger = c; } },
      { kw: ['提示', '注意', 'warn'], label: '提示', set: (c) => { token.palette.warn = c; } },
    ];
    for (const tgt of colorTargets) {
      if (tgt.kw.some((k) => clause.includes(k))) {
        const c = extractHex(clause) ?? extractNamedColor(clause);
        if (c) { tgt.set(c); applied.push(`配色·${tgt.label} → ${c}`); }
      }
    }

    // —— 字体 ——
    const fontTargets: { kw: string[]; label: string; set: (f: string) => void }[] = [
      { kw: ['标题', 'title'], label: '标题字体', set: (f) => { token.typography.titleFont = f; } },
      { kw: ['正文', 'body'], label: '正文字体', set: (f) => { token.typography.bodyFont = f; } },
      { kw: ['编号', '等宽', 'mono'], label: '编号字体', set: (f) => { token.typography.monoFont = f; } },
    ];
    for (const tgt of fontTargets) {
      if (tgt.kw.some((k) => clause.includes(k))) {
        const fam = Object.keys(FONT_FAMILIES).find((k) => clause.toLowerCase().includes(k.toLowerCase()));
        if (fam) { tgt.set(FONT_FAMILIES[fam]); applied.push(`字体·${tgt.label} → ${fam}`); }
      }
    }

    // —— 纹理 ——
    for (const tx of TEXTURES) {
      if (tx.kw.some((k) => clause.toLowerCase().includes(k.toLowerCase()))) {
        token.texture.key = tx.v;
        applied.push(`纹理 → ${tx.v}`);
        break;
      }
    }

    // —— 语气 ——
    for (const r of REGISTERS) {
      if (r.kw.some((k) => clause.includes(k))) {
        token.tone.register = r.v;
        applied.push(`语气 → ${r.v}`);
        break;
      }
    }

    // —— 画幅 ——
    for (const p of PAGES) {
      if (p.kw.some((k) => clause.toLowerCase().includes(k.toLowerCase()))) {
        token.layout.page = p.v;
        applied.push(`画幅 → ${p.v}`);
        break;
      }
    }
  }

  return { token, applied };
}
