// ============================================================
// utils/consistency.ts 单元测试
// 守护一致性引擎六大规则（纯函数）：重名/空名/悬空关系/
// 孤立实体/对称缺失/重复关系 + summarize 统计。
// 强规则不可关，弱规则可经 disabledWeak 关闭。
// ============================================================

import { describe, it, expect } from 'vitest';
import { scanConflicts, summarize } from './consistency';
import type { WikiEntity, WikiRelation } from '../types';

const ent = (id: string, name: string, type: WikiEntity['type'] = 'character'): WikiEntity => ({
  id, type, name, fields: [], custom: [], tags: [], createdAt: 1, updatedAt: 1,
});

const rel = (id: string, source: string, target: string, type: WikiRelation['type'] = 'custom'): WikiRelation => ({
  id, source, target, type,
});

const byRule = (conflicts: { ruleId: string }[], ruleId: string) =>
  conflicts.filter((c) => c.ruleId === ruleId);

describe('scanConflicts · 强规则', () => {
  it('重名实体（忽略大小写与首尾空格）', () => {
    const entities = [ent('a', ' 林夜 '), ent('b', '林夜'), ent('c', '林叶')];
    const c = scanConflicts(entities, []);
    expect(byRule(c, 'duplicate-name')).toHaveLength(1); // a/b 重复，c 独立
  });

  it('空名称与「未命名」', () => {
    const entities = [ent('a', ''), ent('b', '未命名'), ent('c', '正常')];
    const c = scanConflicts(entities, []);
    expect(byRule(c, 'empty-name')).toHaveLength(2);
  });

  it('悬空关系（source 或 target 不存在）', () => {
    const entities = [ent('a', '甲')];
    const relations = [rel('r1', 'a', 'ghost'), rel('r2', 'ghost2', 'a')];
    const c = scanConflicts(entities, relations);
    expect(byRule(c, 'dangling-relation')).toHaveLength(2);
  });

  it('强规则不受 disabledWeak 影响', () => {
    const entities = [ent('a', '林夜'), ent('b', '林夜')];
    const c = scanConflicts(entities, [], { disabledWeak: ['duplicate-name'] });
    // duplicate-name 是 strong，disabledWeak 只关弱规则 → 仍检出
    expect(byRule(c, 'duplicate-name')).toHaveLength(1);
  });
});

describe('scanConflicts · 弱规则（可关）', () => {
  it('孤立实体：无任何关系连线', () => {
    const entities = [ent('a', '甲'), ent('b', '乙')];
    const relations = [rel('r1', 'a', 'b', 'belongs')];
    const c = scanConflicts(entities, relations);
    expect(byRule(c, 'orphan-entity')).toHaveLength(0); // 无孤立（a/b 都连线）
    const c2 = scanConflicts([ent('a', '甲'), ent('c', '丙')], relations);
    expect(byRule(c2, 'orphan-entity')).toHaveLength(1); // 丙孤立
  });

  it('对称关系缺失反向（kin/enemy）', () => {
    const entities = [ent('a', '甲'), ent('b', '乙')];
    const relations = [rel('r1', 'a', 'b', 'enemy')]; // 缺 b→a 反向
    const c = scanConflicts(entities, relations);
    expect(byRule(c, 'symmetry')).toHaveLength(1);

    const both = [rel('r1', 'a', 'b', 'enemy'), rel('r2', 'b', 'a', 'enemy')];
    expect(byRule(scanConflicts(entities, both), 'symmetry')).toHaveLength(0);
  });

  it('重复关系：同对实体同类型去重', () => {
    const entities = [ent('a', '甲'), ent('b', '乙')];
    const relations = [rel('r1', 'a', 'b', 'belongs'), rel('r2', 'b', 'a', 'belongs')];
    const c = scanConflicts(entities, relations);
    expect(byRule(c, 'duplicate-relation')).toHaveLength(1); // 排序后 a|b|belongs 重复
  });

  it('disabledWeak 可关闭弱规则', () => {
    const entities = [ent('a', '甲'), ent('b', '乙')];
    const relations = [rel('r1', 'a', 'b', 'enemy')];
    const c = scanConflicts(entities, relations, { disabledWeak: ['symmetry', 'orphan-entity'] });
    expect(byRule(c, 'symmetry')).toHaveLength(0);
    expect(byRule(c, 'orphan-entity')).toHaveLength(0);
  });
});

describe('summarize', () => {
  it('统计强/弱冲突数量', () => {
    const entities = [ent('a', '林夜'), ent('b', '林夜'), ent('c', '孤立')];
    const relations = [rel('r1', 'a', 'ghost', 'kin')];
    const conflicts = scanConflicts(entities, relations);
    const s = summarize(conflicts);
    expect(s.strong).toBe(2); // 重名 + 悬空
    expect(s.weak).toBeGreaterThanOrEqual(1); // 孤立/对称至少一个
    expect(s.total).toBe(conflicts.length);
  });
});
