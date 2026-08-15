import { describe, it, expect } from 'vitest';
import { scanForeshadow, countOpenForeshadow, validateForeshadowNode, foreshadowEntities } from './foreshadowLedger';
import type { OutlineNode } from './types';

const node = (id: string, order: number, f?: { setup: boolean; payoff: boolean }, entityIds?: string[]): OutlineNode => ({
  id, title: `节点${id}`, kind: 'chapter', parentId: null, order, status: 'todo',
  entityIds, foreshadow: f, createdAt: 1, updatedAt: 1,
});

describe('scanForeshadow 伏笔扫描', () => {
  it('open / paid / orphan 三类正确归类', () => {
    const outline = [
      node('a', 0, { setup: true, payoff: false }), // open
      node('b', 1, { setup: true, payoff: true }),  // paid
      node('c', 2, { setup: false, payoff: true }), // orphan
      node('d', 3),                                  // 无标记
      node('e', 4, { setup: true, payoff: false }), // open
    ];
    const ledger = scanForeshadow(outline);
    expect(ledger.open.map((n) => n.id)).toEqual(['a', 'e']);
    expect(ledger.paid.map((n) => n.id)).toEqual(['b']);
    expect(ledger.orphan.map((n) => n.id)).toEqual(['c']);
    expect(ledger.counts).toEqual({ open: 2, paid: 1, orphan: 1 });
  });

  it('空/undefined 大纲返回空账本', () => {
    expect(scanForeshadow(undefined).counts.open).toBe(0);
    expect(scanForeshadow([]).counts.paid).toBe(0);
  });

  it('按 order 排序', () => {
    const outline = [node('x', 5, { setup: true, payoff: false }), node('y', 1, { setup: true, payoff: false })];
    expect(scanForeshadow(outline).open.map((n) => n.id)).toEqual(['y', 'x']);
  });
});

describe('countOpenForeshadow 计数', () => {
  it('统计未回收伏笔数', () => {
    const outline = [node('a', 0, { setup: true, payoff: false }), node('b', 1, { setup: true, payoff: true })];
    expect(countOpenForeshadow(outline)).toBe(1);
    expect(countOpenForeshadow(undefined)).toBe(0);
  });
});

describe('validateForeshadowNode 校验', () => {
  it('孤儿回收 / 空标记提示', () => {
    expect(validateForeshadowNode(node('a', 0, { setup: false, payoff: true }))).toContain('没有埋设');
    expect(validateForeshadowNode(node('b', 1, { setup: false, payoff: false }))).toContain('空伏笔标记');
    expect(validateForeshadowNode(node('c', 2, { setup: true, payoff: false }))).toBeNull();
    expect(validateForeshadowNode(node('d', 3))).toBeNull();
  });
});

describe('foreshadowEntities 关联实体', () => {
  it('id → 名称映射', () => {
    const n = node('a', 0, { setup: true, payoff: false }, ['e1', 'e2', 'ghost']);
    const names = foreshadowEntities(n, [{ id: 'e1', name: '星辉议会' }, { id: 'e2', name: '云隐城' }]);
    expect(names).toEqual(['星辉议会', '云隐城']);
  });
  it('无关联返回空', () => {
    expect(foreshadowEntities(node('a', 0), [])).toEqual([]);
  });
});
