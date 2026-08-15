// ============================================================
// features/agent/snapshot.ts + memory.ts 单元测试
// 守护世界快照打包（topK/大纲树/预算裁减）与三级记忆调度
//（优先级：会话 > 工作 > 长期，预算内丢弃）。
// ============================================================

import { describe, it, expect } from 'vitest';
import { buildWorldSnapshot } from './snapshot';
import { composeMemory } from './memory';
import type { WorldData } from '../../store/worldStore';
import type { Timeline } from '../../types';

const ent = (id: string, name: string, updatedAt = 1, note?: string): any => ({
  id, type: 'character', name, fields: [], custom: [], tags: [], note, updatedAt, createdAt: 1,
});

const world = (over: Partial<WorldData> = {}): WorldData =>
  ({
    folders: [], docs: [], timelines: [], styles: [], materials: [], templates: [],
    entities: [], relations: [], drafts: [], activeDocId: '', activeTimelineId: '',
    clueBoard: {}, proposals: [], chats: [], outline: [],
    ...over,
  }) as WorldData;

describe('buildWorldSnapshot', () => {
  it('实体按最近更新取 topK', () => {
    const w = world({ entities: [ent('a', '配角', 1), ent('b', '主角', 99), ent('c', '路人', 5)] });
    const r = buildWorldSnapshot(w, { entityTopK: 2 });
    expect(r.text).toContain('主角'); // updatedAt 降序：b(99) → c(5) → a(1)，取前 2
    expect(r.text).toContain('路人');
    expect(r.text).not.toContain('配角');
    expect(r.stats.entities).toBe(2); // 快照实际包含数量（topK 后）
  });

  it('大纲树按缩进还原层级', () => {
    const w = world({
      outline: [
        { id: 'v1', title: '第一卷', kind: 'volume' as const, parentId: null, order: 0, status: 'todo' as const, createdAt: 1, updatedAt: 1 },
        { id: 'c1', title: '第一章', kind: 'chapter' as const, parentId: 'v1', order: 0, status: 'drafting' as const, createdAt: 1, updatedAt: 1 },
      ],
    });
    const r = buildWorldSnapshot(w);
    expect(r.text).toContain('「第一卷」');
    expect(r.text).toContain('「第一章」');
    expect(r.text).toContain('（进行中）');
    expect(r.text.indexOf('第一章')).toBeGreaterThan(r.text.indexOf('第一卷')); // 子节点在父之后
  });

  it('超预算时丢弃低优先级段（docs 先丢，entities 保留）', () => {
    const w = world({
      entities: [ent('a', '主角甲', 99)],
      docs: [
        { id: 'd1', title: '很长的文档标题'.repeat(30), content: '', icon: '', folder: '' },
        { id: 'd2', title: '很长的文档标题'.repeat(30), content: '', icon: '', folder: '' },
      ],
    });
    const r = buildWorldSnapshot(w, { tokenBudget: 50 });
    expect(r.truncated).toBe(true);
    expect(r.text).toContain('主角甲');
    expect(r.text).not.toContain('很长的文档标题');
  });

  it('时间线与关系包含在快照中', () => {
    const tl: Timeline = { id: 't1', name: '主线', events: [{ id: 'e1', label: '星陨之夜', year: 100 }] };
    const w = world({
      relations: [{ id: 'r1', source: 'a', target: 'b', type: 'enemy' as const, createdAt: 1 }],
      timelines: [tl],
      entities: [ent('a', '甲'), ent('b', '乙')],
    });
    const r = buildWorldSnapshot(w);
    expect(r.text).toContain('星陨之夜');
    expect(r.text).toContain('甲 → 乙');
  });

  it('空世界返回空文本（不崩溃）', () => {
    const r = buildWorldSnapshot(world());
    expect(r.totalTokens).toBe(0);
    expect(r.truncated).toBe(false);
  });
});

describe('composeMemory（三级记忆调度）', () => {
  it('会话级必保，超预算时按最近保留', () => {
    const r = composeMemory({ session: ['第一段', '第二段'], workspace: [], longTerm: [] }, 5);
    expect(r.text).toContain('第二段');
    expect(r.text).not.toContain('第一段');
    expect(r.dropped.length).toBeGreaterThan(0);
  });

  it('预算充足时三级全保留', () => {
    const r = composeMemory(
      { session: ['会话'], workspace: ['工作'], longTerm: ['长期'] },
      1000,
    );
    expect(r.text).toContain('会话');
    expect(r.text).toContain('工作');
    expect(r.text).toContain('长期');
    expect(r.dropped).toEqual([]);
  });

  it('预算不足时先丢长期级再丢工作级，会话保留', () => {
    const long = '长期记忆内容'.repeat(50); // 大块
    const r = composeMemory(
      { session: ['会话'], workspace: ['工作级事件'], longTerm: [long, long] },
      30,
    );
    expect(r.text).toContain('会话');
    expect(r.text).toContain('工作级事件'); // 工作级优先于长期
    expect(r.text).not.toContain('长期记忆内容');
    expect(r.dropped.length).toBeGreaterThanOrEqual(1);
  });

  it('空输入安全', () => {
    const r = composeMemory({ session: [], workspace: [], longTerm: [] }, 100);
    expect(r.totalTokens).toBe(0);
    expect(r.text).toBe('');
  });
});
