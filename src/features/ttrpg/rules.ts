// ============================================================
// 跑团规则引擎（Phase 4a）
// ------------------------------------------------------------
// 纯函数：骰子表达式解析与掷骰（1d20+3 / d100 / 2d6）、技能检定
// （公式变量 {attr}/{skill} 替换 + 难度判定）、三套内置规则骨架
// （DND5e 简化 / COC7 简化 / Cyberpunk RED 简化——仅结构与通用数值，
// 不内置商业 IP 完整规则，版权红线；完整规则书由用户 .fugurule 导入）。
// ============================================================

import type { Rulebook, SkillDef } from './types';

/* ==================== 骰子 ==================== */

/** 骰子表达式解析：{count}d{faces}，支持 +N / -N / *N 修饰；返回 null 表示非法 */
export function parseDice(expr: string): { count: number; faces: number; mod: number } | null {
  const m = /^\s*(\d*)d(\d+)\s*([+-]\s*\d+)?\s*$/.exec(expr || '');
  if (!m) return null;
  const count = m[1] ? Math.max(1, parseInt(m[1], 10)) : 1;
  const faces = parseInt(m[2], 10);
  if (faces < 1) return null;
  const mod = m[3] ? parseInt(m[3].replace(/\s+/g, ''), 10) || 0 : 0;
  return { count: Math.min(count, 100), faces, mod };
}

/** 掷骰：返回每次结果数组与总计 */
export function rollDice(expr: string, rng: () => number = Math.random): { rolls: number[]; total: number } | null {
  const d = parseDice(expr);
  if (!d) return null;
  const rolls = Array.from({ length: d.count }, () => Math.floor(rng() * d.faces) + 1);
  return { rolls, total: rolls.reduce((a, b) => a + b, 0) + d.mod };
}

/** 人类可读掷骰描述，如「1d20+3 → [14]+3 = 17」 */
export function describeRoll(expr: string, rng?: () => number): string | null {
  const d = parseDice(expr);
  const r = rollDice(expr, rng);
  if (!d || !r) return null;
  const mod = d.mod !== 0 ? `${d.mod > 0 ? '+' : ''}${d.mod}` : '';
  return `${expr} → [${r.rolls.join(', ')}]${mod} = ${r.total}`;
}

/* ==================== 技能检定 ==================== */

/**
 * 检定公式求值：把 {attr} / {skill} 变量替换为角色值后计算。
 * 支持两种形态：
 *  - 成功式：`1d20+{attr}+{skill}` → 掷骰结果 >= 难度 即成功
 *  - 阈值式：`d100<=({skill}*5)` → 掷骰结果 <= 阈值 即成功（COC 风格）
 */
export function evaluateFormula(
  formula: string,
  ctx: { attr: Record<string, number>; skill: Record<string, number>; rng?: () => number },
): { success: boolean; total: number; detail: string } {
  const rng = ctx.rng ?? Math.random;
  const replace = (s: string) =>
    s
      .replace(/\{attr:([^}]+)\}|\{attr\}/g, (_, k?: string) => {
        const key = k || Object.keys(ctx.attr)[0] || '';
        return String(ctx.attr[key] ?? 0);
      })
      .replace(/\{skill:([^}]+)\}|\{skill\}/g, (_, k?: string) => {
        const key = k || Object.keys(ctx.skill)[0] || '';
        return String(ctx.skill[key] ?? 0);
      });

  // 阈值式：d100<=... / 1d20<=...
  const le = /^\s*(\d*d?\d+)\s*<=\s*(.+)$/.exec(formula);
  if (le) {
    const diceExpr = le[1].includes('d') ? le[1] : `${le[1]}d1`; // 纯数字视为骰子面数 1
    const r = rollDice(diceExpr, rng);
    if (!r) return { success: false, total: 0, detail: `公式非法：${formula}` };
    const threshold = safeEval(replace(le[2]));
    const success = r.total <= threshold;
    return { success, total: r.total, detail: `${le[1]} → [${r.rolls.join(', ')}] = ${r.total} ≤ ${threshold}（阈值）→ ${success ? '成功' : '失败'}` };
  }

  // 成功式：1d20+...>= 难度（无 >= 时默认 >= difficulty）
  const ge = /^\s*(\d*d?\d+)(.*)$/.exec(formula);
  if (!ge) return { success: false, total: 0, detail: `公式非法：${formula}` };
  const diceExpr = ge[1];
  const r = rollDice(diceExpr, rng);
  if (!r) return { success: false, total: 0, detail: `公式非法：${formula}` };
  // 修饰段（+N）已含在 rollDice 中，变量替换掉 rest
  const rest = replace(ge[2]);
  const modVal = safeEval(rest) || 0;
  const total = r.total + modVal;
  return { success: total >= 0, total, detail: `${diceExpr}${rest} → [${r.rolls.join(', ')}]${rest} = ${total}` };
}

/** 安全求值简单算术表达式（仅数字与 + - * / 括号） */
function safeEval(expr: string): number {
  const t = (expr || '').trim();
  if (!t) return 0;
  if (!/^[\d\s+\-*/().]+$/.test(t)) return 0;
  try {
    // eslint-disable-next-line no-new-func
    return Function(`"use strict"; return (${t});`)();
  } catch {
    return 0;
  }
}

/** 按难度表判定：difficulty 为 Record<难度名, 阈值>，>= 阈值即通过 */
export function checkDifficulty(rulebook: Rulebook, total: number, difficultyKey = 'normal'): { passed: boolean; dc: number } {
  const dc = rulebook.difficulty[difficultyKey] ?? rulebook.difficulty['normal'] ?? 10;
  return { passed: total >= dc, dc };
}

/* ==================== 内置规则骨架（版权红线：仅结构与通用数值） ==================== */

export const BUILTIN_RULEBOOKS: Rulebook[] = [
  {
    id: 'rb-dnd5e',
    name: 'DND5e 简化（骨架）',
    universe: 'dnd5e',
    dice: '1d20',
    stats: ['力量', '敏捷', '体质', '智力', '感知', '魅力'],
    skills: [
      { name: '运动', base: '力量' },
      { name: '隐匿', base: '敏捷' },
      { name: '洞察', base: '感知' },
      { name: '说服', base: '魅力' },
      { name: '奥术', base: '智力' },
    ] as SkillDef[],
    formula: '1d20+{attr}+{skill}',
    difficulty: { easy: 10, normal: 15, hard: 20, veryHard: 25 },
    meta: '简化 DND5e 骨架：d20 检定，属性调整值+技能熟练加值，难度 DC 10/15/20/25。完整规则书请导入 .fugurule。',
  },
  {
    id: 'rb-coc7',
    name: 'COC7 简化（骨架）',
    universe: 'coc7',
    dice: '1d100',
    stats: ['力量', '体质', '敏捷', '外貌', '智力', '意志', '教育', '幸运'],
    skills: [
      { name: '侦查', base: '智力' },
      { name: '潜行', base: '敏捷' },
      { name: '聆听', base: '感知' },
      { name: '图书馆使用', base: '教育' },
      { name: '说服', base: '魅力' },
    ] as SkillDef[],
    formula: '1d100<=({skill}*5)',
    difficulty: { 常规成功: 50, 困难成功: 20, 极难成功: 5 },
    meta: '简化 COC7 骨架：d100 百分比检定，≤ 技能值×5 为常规成功。完整规则书请导入 .fugurule。',
  },
  {
    id: 'rb-cyberpunk-red',
    name: 'Cyberpunk RED 简化（骨架）',
    universe: 'cyberpunk-red',
    dice: '1d10',
    stats: ['力量', '体质', '敏捷', '智力', '意志', '魅力', '共情', '科技'],
    skills: [
      { name: '徒手', base: '力量' },
      { name: '闪避', base: '敏捷' },
      { name: '驾驶', base: '敏捷' },
      { name: '黑客', base: '科技' },
      { name: '交涉', base: '魅力' },
    ] as SkillDef[],
    formula: '1d10+{attr}+{skill}',
    difficulty: { 简单: 10, 普通: 13, 困难: 15, 极难: 17 },
    meta: '简化 Cyberpunk RED 骨架：d10 检定，属性+技能加值，难度 10/13/15/17。完整规则书请导入 .fugurule。',
  },
];

/** 按 universe 或 id 找内置骨架（导入 .fugurule 前可作默认） */
export function findBuiltinRulebook(key: string): Rulebook | undefined {
  return BUILTIN_RULEBOOKS.find((r) => r.id === key || r.universe === key);
}
