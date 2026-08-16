// ============================================================
// features/ttrpg/fugurule.ts 单元测试
// 守护规则书序列化/反序列化与结构校验。
// ============================================================

import { describe, it, expect } from 'vitest';
import { serializeRulebook, deserializeRulebook, rulebookFilename } from './fugurule';
import { BUILTIN_RULEBOOKS } from './rules';
import type { Rulebook } from './types';

describe('serializeRulebook / deserializeRulebook', () => {
  it('序列化后往返一致', () => {
    const rb = BUILTIN_RULEBOOKS[0];
    const raw = serializeRulebook(rb);
    expect(raw).toContain('floatlight-rulebook');
    const { rulebook, error } = deserializeRulebook(raw);
    expect(error).toBeUndefined();
    expect(rulebook!.name).toBe(rb.name);
    expect(rulebook!.formula).toBe(rb.formula);
    expect(rulebook!.stats.length).toBe(rb.stats.length);
    expect(rulebook!.difficulty).toEqual(rb.difficulty);
  });

  it('非法输入返回明确错误', () => {
    expect(deserializeRulebook('not json').error).toContain('JSON');
    expect(deserializeRulebook('{}').error).toContain('规则书名');
    expect(deserializeRulebook('{"name":"X","dice":"abc"}').error).toContain('默认骰子');
    expect(deserializeRulebook('{"name":"X","dice":"1d20","formula":"no-var","stats":["力"],"skills":[],"difficulty":{}}').error).toContain('检定公式');
  });

  it('困难度空表被拒绝', () => {
    const bad: Rulebook = { id: 'x', name: 'X', dice: '1d20', stats: ['力'], skills: [], formula: '1d20+{attr}', difficulty: {}, meta: '' };
    const { error } = deserializeRulebook(serializeRulebook(bad));
    expect(error).toContain('难度阈值表');
  });

  it('缺失 id 自动生成', () => {
    const rb: Rulebook = { id: '', name: '自定义', dice: '1d6', stats: ['智'], skills: [{ name: '灵能', base: '智' }], formula: '1d6+{attr}', difficulty: { 简单: 4 }, meta: '' };
    const { rulebook } = deserializeRulebook(serializeRulebook(rb));
    expect(rulebook!.id).toMatch(/^rb-/);
    expect(rulebook!.universe).toBe('custom');
  });
});

describe('rulebookFilename', () => {
  it('过滤非法字符', () => {
    expect(rulebookFilename('COC7:完整规则')).toContain('规则书_COC7_完整规则.fugurule');
  });
});
