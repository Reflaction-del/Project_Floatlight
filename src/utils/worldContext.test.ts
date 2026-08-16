// ============================================================
// utils/worldContext.ts 单元测试
// 守护世界观上下文引擎的纯函数：
// tokenize（CJK 友好分词）、estimateTokens（token 估算）、
// extractCited（生成后反查被提及实体）。
// 注意：本文件顶层 import 多个 store，若 node 环境 import 失败，
// 说明模块耦合了运行时环境，需在测试中 mock（见文件头注释）。
// ============================================================

import { describe, it, expect } from 'vitest';
import { tokenize, estimateTokens, extractCited } from './worldContext';
import type { WikiEntity } from '../types';

describe('tokenize（CJK 友好分词）', () => {
  it('英文/数字词整体保留', () => {
    const t = tokenize('Miria 123');
    expect(t).toContain('miria');
    expect(t).toContain('123');
  });

  it('中文拆为单字与连续二元组，过滤停用词', () => {
    const t = tokenize('星夜城');
    // 单字：星/夜/城；二元组：星夜/夜城
    expect(t).toContain('星');
    expect(t).toContain('夜');
    expect(t).toContain('星夜');
    expect(t).toContain('夜城');
    // 停用词过滤
    expect(tokenize('我的城')).not.toContain('的');
  });

  it('空输入返回空数组', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('   ')).toEqual([]);
  });
});

describe('estimateTokens（token 估算）', () => {
  it('中文按 0.8/字、非中文按 0.25/字符估算', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('浮光')).toBe(Math.ceil(2 * 0.8)); // 2
    expect(estimateTokens('abcd')).toBe(Math.max(1, Math.ceil(4 * 0.25))); // 1
  });

  it('估算结果至少为 1（非空输入）', () => {
    expect(estimateTokens('a')).toBe(1);
  });
});

describe('extractCited（生成后反查被提及实体）', () => {
  const entities: WikiEntity[] = [
    { id: 'a', type: 'character', name: '林夜', fields: [], custom: [], tags: [], createdAt: 1, updatedAt: 1 },
    { id: 'b', type: 'location', name: '星夜城', fields: [], custom: [], tags: [], createdAt: 1, updatedAt: 1 },
  ];

  it('输出中出现实体名则返回其 id', () => {
    const cited = extractCited('林夜回到了星夜城', entities);
    expect(cited).toContain('a');
    expect(cited).toContain('b');
  });

  it('未提及任何实体返回空数组', () => {
    expect(extractCited('一片平静的日常', entities)).toEqual([]);
  });
});
