// ============================================================
// 大纲树操作（纯函数，便于单测与 Agent 工具复用）
// ------------------------------------------------------------
// treeify：扁平数组 → 树；collectSubtreeIds：子树收集（级联删除用）；
// removeSubtree：级联删除；moveNode：移动（防成环）；nextOrder：同级下一个序号。
// ============================================================

import type { OutlineNode } from './types';

export interface OutlineTreeNode extends OutlineNode {
  children: OutlineTreeNode[];
}

/** 扁平大纲数组 → 树（按 order 排序，parentId 递归，任意深度）。
 * 父节点不存在的「孤儿节点」归入根层，避免数据缺失时节点丢失。 */
export function treeify(nodes: OutlineNode[]): OutlineTreeNode[] {
  const ids = new Set(nodes.map((n) => n.id));
  const byParent = new Map<string | null, OutlineNode[]>();
  for (const n of nodes) {
    const k = n.parentId && ids.has(n.parentId) ? n.parentId : null; // 父缺失 → 根层
    const arr = byParent.get(k) ?? [];
    arr.push(n);
    byParent.set(k, arr);
  }
  const build = (parentId: string | null): OutlineTreeNode[] =>
    (byParent.get(parentId) ?? [])
      .sort((a, b) => a.order - b.order)
      .map((n) => ({ ...n, children: build(n.id) }));
  return build(null);
}

/** 收集以 rootId 为根的子树全部 id（含自身），级联删除 / 成环校验用 */
export function collectSubtreeIds(nodes: OutlineNode[], rootId: string): string[] {
  const out: string[] = [];
  const walk = (id: string) => {
    out.push(id);
    for (const n of nodes) if (n.parentId === id) walk(n.id);
  };
  walk(rootId);
  return out;
}

/** 级联删除以 rootId 为根的子树，返回新数组 */
export function removeSubtree(nodes: OutlineNode[], rootId: string): OutlineNode[] {
  const rm = new Set(collectSubtreeIds(nodes, rootId));
  return nodes.filter((n) => !rm.has(n.id));
}

/**
 * 移动节点到 newParentId 下的 newOrder 位置。
 * 非法（目标父级为自身或其子孙 → 成环；节点不存在）时返回 null；成功返回重排后的新数组。
 * 返回前对所有父级统一重新编号，保证同级 order 连续无重复。
 */
export function moveNode(
  nodes: OutlineNode[],
  id: string,
  newParentId: string | null,
  newOrder: number,
): OutlineNode[] | null {
  if (newParentId === id) return null;
  const subtree = new Set(collectSubtreeIds(nodes, id));
  if (newParentId && subtree.has(newParentId)) return null;
  const moving = nodes.find((n) => n.id === id);
  if (!moving) return null;

  const others = nodes.filter((n) => n.id !== id);
  const siblings = others
    .filter((n) => (n.parentId ?? null) === (newParentId ?? null))
    .sort((a, b) => a.order - b.order);
  const at = Math.max(0, Math.min(newOrder, siblings.length));
  // 关键：移动时更新 parentId，且 order 赋为目标位序（旧实现保留旧 order，
  // normalizeOrders 重排后会被更高的旧 order 挤到后面，导致「移动到前面」失效）
  siblings.splice(at, 0, { ...moving, parentId: newParentId, order: at });
  const merged = [...others.filter((n) => (n.parentId ?? null) !== (newParentId ?? null)), ...siblings];
  return normalizeOrders(merged);
}

/** 全量重排：每个父级下按 order 排序后重新连续编号（消除移动后的空洞/重复） */
function normalizeOrders(nodes: OutlineNode[]): OutlineNode[] {
  const byParent = new Map<string | null, OutlineNode[]>();
  for (const n of nodes) {
    const k = n.parentId ?? null;
    const arr = byParent.get(k) ?? [];
    arr.push(n);
    byParent.set(k, arr);
  }
  const out: OutlineNode[] = [];
  for (const arr of byParent.values()) {
    arr.sort((a, b) => a.order - b.order);
    arr.forEach((n, i) => out.push({ ...n, order: i }));
  }
  return out;
}

/** 同级下一个可用 order（追加子节点用） */
export function nextOrder(nodes: OutlineNode[], parentId: string | null): number {
  return nodes.filter((n) => (n.parentId ?? null) === (parentId ?? null)).length;
}
