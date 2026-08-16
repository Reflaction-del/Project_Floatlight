// ============================================================
// features/outline/outlineOps.ts 单元测试
// 守护大纲树纯函数：treeify 还原 / 子树收集 / 级联删除 /
// moveNode 移动（防成环）/ nextOrder 序号。
// ============================================================

import { describe, it, expect } from 'vitest';
import { treeify, collectSubtreeIds, removeSubtree, moveNode, nextOrder } from './outlineOps';
import type { OutlineNode } from './types';

const node = (id: string, title: string, parentId: string | null = null, order = 0): OutlineNode => ({
  id, title, parentId, order, kind: 'chapter', status: 'todo', createdAt: 1, updatedAt: 1,
});

const flat: OutlineNode[] = [
  node('v1', '第一卷', null, 0),
  node('v2', '第二卷', null, 1),
  node('c1', '第一章', 'v1', 0),
  node('c2', '第二章', 'v1', 1),
  node('s1', '场景A', 'c1', 0),
];

describe('treeify', () => {
  it('按 order 排序并还原任意深度树', () => {
    const tree = treeify(flat);
    expect(tree.map((n) => n.id)).toEqual(['v1', 'v2']);
    expect(tree[0].children.map((n) => n.id)).toEqual(['c1', 'c2']);
    expect(tree[0].children[0].children[0].id).toBe('s1'); // 三层
  });

  it('空数组返回空树', () => {
    expect(treeify([])).toEqual([]);
  });

  it('孤儿节点（父缺失）出现在根层', () => {
    const t = treeify([node('x', '父不存在', 'ghost'), node('v1', '卷')]);
    expect(t.map((n) => n.id)).toContain('x');
  });
});

describe('collectSubtreeIds / removeSubtree', () => {
  it('收集含自身的整棵子树', () => {
    expect(collectSubtreeIds(flat, 'v1').sort()).toEqual(['v1', 'c1', 'c2', 's1'].sort());
  });

  it('级联删除子树', () => {
    const next = removeSubtree(flat, 'v1');
    expect(next.map((n) => n.id)).toEqual(['v2']);
  });
});

describe('moveNode', () => {
  it('移动到另一父级并重排', () => {
    const next = moveNode(flat, 'c1', 'v2', 0)!;
    expect(next.find((n) => n.id === 'c1')?.parentId).toBe('v2');
    expect(next.find((n) => n.id === 'c1')?.order).toBe(0);
  });

  it('同父级内重排', () => {
    const next = moveNode(flat, 'c2', 'v1', 0)!;
    const underV1 = next.filter((n) => n.parentId === 'v1').sort((a, b) => a.order - b.order);
    expect(underV1.map((n) => n.id)).toEqual(['c2', 'c1']);
  });

  it('拒绝移到自身', () => {
    expect(moveNode(flat, 'c1', 'c1', 0)).toBeNull();
  });

  it('拒绝移到自己子孙下（防成环）', () => {
    expect(moveNode(flat, 'v1', 's1', 0)).toBeNull();
    expect(moveNode(flat, 'c1', 's1', 0)).toBeNull();
  });

  it('未知节点返回 null', () => {
    expect(moveNode(flat, 'ghost', null, 0)).toBeNull();
  });
});

describe('nextOrder', () => {
  it('同级追加序号为现有同级数量', () => {
    expect(nextOrder(flat, 'v1')).toBe(2); // c1/c2
    expect(nextOrder(flat, null)).toBe(2); // v1/v2
    expect(nextOrder(flat, 'c2')).toBe(0); // 无子节点
  });
});
