// ============================================================
// 伏笔账本（Phase 5 质量增强）
// ------------------------------------------------------------
// 扫描大纲节点的 foreshadow.setup/payoff 标记：
// - open：已埋设未回收（需要回收提醒）
// - paid：已埋设已回收
// - orphan：标记了回收但从未埋设（疑似失误标记）
// ============================================================
import type { OutlineNode } from '../outline/types';

export type ForeshadowStatus = 'open' | 'paid' | 'orphan';

export interface ForeshadowLedger {
  /** 已埋设未回收（写作时需记得回收） */
  open: OutlineNode[];
  /** 已埋设已回收 */
  paid: OutlineNode[];
  /** 标记回收但无埋设节点（孤儿，提示核对） */
  orphan: OutlineNode[];
  /** 统计 */
  counts: { open: number; paid: number; orphan: number };
}

/** 扫描大纲生成伏笔账本 */
export function scanForeshadow(outline: OutlineNode[] | undefined): ForeshadowLedger {
  const open: OutlineNode[] = [];
  const paid: OutlineNode[] = [];
  const orphan: OutlineNode[] = [];
  for (const n of outline ?? []) {
    const f = n.foreshadow;
    if (!f) continue;
    if (f.setup && f.payoff) paid.push(n);
    else if (f.setup) open.push(n);
    else if (f.payoff) orphan.push(n);
  }
  // 按位置（order 序）排序保持大纲顺序
  const byOrder = (a: OutlineNode, b: OutlineNode) => a.order - b.order;
  open.sort(byOrder);
  paid.sort(byOrder);
  orphan.sort(byOrder);
  return {
    open,
    paid,
    orphan,
    counts: { open: open.length, paid: paid.length, orphan: orphan.length },
  };
}

/** 未回收伏笔数量（大纲视图徽标用） */
export function countOpenForeshadow(outline: OutlineNode[] | undefined): number {
  return scanForeshadow(outline).counts.open;
}

/** 校验单个节点伏笔标记是否自洽；返回问题描述（null = 正常） */
export function validateForeshadowNode(node: OutlineNode): string | null {
  const f = node.foreshadow;
  if (!f) return null;
  if (!f.setup && f.payoff) return '标记了回收但没有埋设（孤儿回收）';
  if (!f.setup && !f.payoff) return '空伏笔标记（无意义）';
  return null;
}

/** 提取伏笔关联实体名（节点 entityIds → 实体名映射） */
export function foreshadowEntities(node: OutlineNode, entities: { id: string; name: string }[]): string[] {
  const byId = new Map(entities.map((e) => [e.id, e.name]));
  return (node.entityIds ?? [])
    .map((id) => byId.get(id))
    .filter((n): n is string => !!n);
}
