// ============================================================
// features/ttrpg/rules.ts 单元测试
// 守护规则引擎纯函数：骰子解析/掷骰、检定公式（成功式与阈值式）、
// 难度判定、内置三套骨架完整性。
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  parseDice,
  rollDice,
  describeRoll,
  evaluateFormula,
  checkDifficulty,
  BUILTIN_RULEBOOKS,
  findBuiltinRulebook,
} from './rules';

const fixedRng = (vals: number[]) => {
  let i = 0;
  return () => vals[i++ % vals.length]; // 0..1，映射到骰面用 floor(rng*faces)+1
};

describe('parseDice', () => {
  it('标准 d20 / 1d20+3 / 2d6-1', () => {
    expect(parseDice('d20')).toEqual({ count: 1, faces: 20, mod: 0 });
    expect(parseDice('1d20+3')).toEqual({ count: 1, faces: 20, mod: 3 });
    expect(parseDice('2d6-1')).toEqual({ count: 2, faces: 6, mod: -1 });
  });

  it('非法输入返回 null', () => {
    expect(parseDice('')).toBeNull();
    expect(parseDice('abc')).toBeNull();
    expect(parseDice('d0')).toBeNull();
  });

  it('省略骰数默认 1，超 100 次截断', () => {
    expect(parseDice('d8')!.count).toBe(1);
    expect(parseDice('500d6')!.count).toBe(100);
  });
});

describe('rollDice / describeRoll', () => {
  it('掷骰结果与总计（含修正）', () => {
    const r = rollDice('2d6+1', fixedRng([0, 0, 0])); // 面值 1,1
    expect(r!.rolls).toEqual([1, 1]);
    expect(r!.total).toBe(3);
  });

  it('describeRoll 人类可读', () => {
    expect(describeRoll('1d20+3', fixedRng([0]))).toBe('1d20+3 → [1]+3 = 4');
  });
});

describe('evaluateFormula', () => {
  it('成功式：1d20+{attr}+{skill}（含难度由调用方判定）', () => {
    const r = evaluateFormula('1d20+{attr}+{skill}', {
      attr: { 力量: 3 }, skill: { 运动: 2 }, rng: fixedRng([0]),
    });
    expect(r.total).toBe(1 + 3 + 2);
    expect(r.detail).toContain('= 6');
  });

  it('阈值式：1d100<=({skill}*5) COC 风格', () => {
    const r = evaluateFormula('1d100<=({skill}*5)', {
      attr: {}, skill: { 侦查: 12 }, rng: fixedRng([0.2]), // 面值 21
    });
    expect(r.success).toBe(true); // 21 <= 60
    expect(r.total).toBe(21);
    const fail = evaluateFormula('1d100<=({skill}*5)', {
      attr: {}, skill: { 侦查: 12 }, rng: fixedRng([0.8]), // 面值 81
    });
    expect(fail.success).toBe(false);
  });

  it('非法公式返回失败', () => {
    const r = evaluateFormula('oops', { attr: {}, skill: {} });
    expect(r.success).toBe(false);
    expect(r.detail).toContain('非法');
  });
});

describe('checkDifficulty', () => {
  it('按难度表判定通过/失败，缺省回退 normal', () => {
    const rb = BUILTIN_RULEBOOKS[0]; // dnd5e: normal=15
    expect(checkDifficulty(rb, 17).passed).toBe(true);
    expect(checkDifficulty(rb, 10).passed).toBe(false);
    expect(checkDifficulty(rb, 22, 'veryHard').passed).toBe(false); // veryHard=25
    expect(checkDifficulty(rb, 26, 'veryHard').passed).toBe(true);
    expect(checkDifficulty(rb, 5, '不存在的难度').passed).toBe(false); // 回退 normal=15
  });
});

describe('BUILTIN_RULEBOOKS（三套骨架）', () => {
  it('包含三套骨架且字段完整', () => {
    expect(BUILTIN_RULEBOOKS.map((r) => r.universe)).toEqual(['dnd5e', 'coc7', 'cyberpunk-red']);
    for (const rb of BUILTIN_RULEBOOKS) {
      expect(rb.stats.length).toBeGreaterThan(0);
      expect(rb.skills.length).toBeGreaterThan(0);
      expect(rb.dice).toMatch(/d\d+/);
      expect(rb.formula).toContain('{');
      expect(Object.keys(rb.difficulty).length).toBeGreaterThan(0);
    }
  });

  it('findBuiltinRulebook 按 id 或 universe 查找', () => {
    expect(findBuiltinRulebook('rb-coc7')?.name).toContain('COC7');
    expect(findBuiltinRulebook('cyberpunk-red')?.universe).toBe('cyberpunk-red');
    expect(findBuiltinRulebook('不存在')).toBeUndefined();
  });
});
