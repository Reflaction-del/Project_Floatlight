// ============================================================
// features/agent/agentPropose.ts 单元测试
// 覆盖 Agent 主动提议引擎的纯函数：名称归一化、编辑距离、
// 同一性判定、合并补全 patch（只补缺口、不覆盖已有数据）。
// ============================================================

import { describe, it, expect } from 'vitest';
import { normalizeName, levenshtein, isSameEntity, buildMergePatch } from './agentPropose';
import type { WikiEntity } from '../../types';
import type { ExtractedEntity } from '../ai/articleExtract';

describe('normalizeName（名称归一化）', () => {
  it('去首尾空格', () => {
    expect(normalizeName(' 林夜 ')).toBe('林夜');
  });

  it('压缩内部空白', () => {
    expect(normalizeName('夜 明 城')).toBe('夜明城');
  });

  it('转小写（英文名）', () => {
    expect(normalizeName('MIRIA')).toBe('miria');
  });

  it('空串安全', () => {
    expect(normalizeName('')).toBe('');
  });
});

describe('levenshtein（编辑距离）', () => {
  it('相同串为 0', () => {
    expect(levenshtein('林夜', '林夜')).toBe(0);
  });

  it('单字替换为 1', () => {
    expect(levenshtein('林夜', '林叶')).toBe(1);
  });

  it('标准用例 kitten→sitting 为 3', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
  });

  it('插入为 1', () => {
    expect(levenshtein('abc', 'abcd')).toBe(1);
  });

  it('空串处理', () => {
    expect(levenshtein('', 'xyz')).toBe(3);
    expect(levenshtein('abc', '')).toBe(3);
  });
});

describe('isSameEntity（同一性判定）', () => {
  it('归一化后精确同名判定为同一', () => {
    expect(isSameEntity('林夜', ' 林夜 ')).toBe(true);
    expect(isSameEntity('Miria', 'miria')).toBe(true);
  });

  it('空名不误判', () => {
    expect(isSameEntity('', '林夜')).toBe(false);
  });

  it('不同名判定为不同（模糊匹配默认关闭，防误报）', () => {
    expect(isSameEntity('林夜', '林叶')).toBe(false);
  });
});

describe('buildMergePatch（合并补全：只补缺口，不覆盖）', () => {
  const existing: WikiEntity = {
    id: 'e1',
    type: 'character',
    name: '林夜',
    fields: [{ label: '身份', value: '剑客' }],
    custom: [],
    tags: ['主角'],
    note: '来自边城',
    createdAt: 1,
    updatedAt: 1,
  };

  const makeIncoming = (over: Partial<ExtractedEntity> = {}): ExtractedEntity => ({
    name: '林夜',
    type: 'character',
    ...over,
  });

  it('只补缺失字段（已有字段跳过），标签并集，不覆盖已有笔记', () => {
    const patch = buildMergePatch(existing, makeIncoming({
      note: '',
      fields: [
        { label: '身份', value: '剑客' }, // 已有 → 跳过
        { label: '年龄', value: '27' }, // 缺失 → 补入
      ],
      tags: ['主角', '反派'],
    }));
    expect(patch).not.toBeNull();
    expect(patch!.fields?.map((f) => f.label)).toEqual(['身份', '年龄']);
    expect(patch!.tags).toEqual(['主角', '反派']);
    expect(patch!.note).toBeUndefined(); // 已有笔记不覆盖
  });

  it('无任何可补内容返回 null（不生成无意义提案）', () => {
    const patch = buildMergePatch(existing, makeIncoming({
      fields: [{ label: '身份', value: '剑客' }],
      tags: ['主角'],
    }));
    expect(patch).toBeNull();
  });

  it('笔记仅当已有为空时写入', () => {
    const noNote: WikiEntity = { ...existing, note: undefined };
    const patch = buildMergePatch(noNote, makeIncoming({ note: ' 新笔记 ' }));
    expect(patch?.note).toBe('新笔记');
  });

  it('空标签/空字段安全（老数据兜底）', () => {
    const legacy: WikiEntity = { id: 'e2', type: 'character', name: '旧实体', fields: [], custom: [], tags: [], createdAt: 1, updatedAt: 1 };
    const patch = buildMergePatch(legacy, makeIncoming({ note: '补全' }));
    expect(patch?.note).toBe('补全');
  });
});
