// ============================================================
// 全局大纲（Phase 1 认知基础）
// ------------------------------------------------------------
// 树形全局大纲：parentId 递归嵌套（任意深度），节点可关联
// 文档 / 时间线 / 实体，支持状态标记与伏笔标记。
// 数据存 WorldData.outline（扁平数组），视图层用 outlineOps.treeify
// 还原为树。Agent 可经 outline 工具读写（走提案队列）。
// ============================================================

/** 大纲节点类型 */
export type OutlineKind = 'arc' | 'volume' | 'chapter' | 'scene' | 'note';

/** 写作状态 */
export type OutlineStatus = 'todo' | 'drafting' | 'done' | 'paused';

/** 大纲节点（任意深度树，扁平存储） */
export interface OutlineNode {
  id: string;
  title: string;
  kind: OutlineKind;
  /** 父节点 id；null = 根节点 */
  parentId: string | null;
  /** 同级排序（从 0 起） */
  order: number;
  status: OutlineStatus;
  /** 一行为 Agent 可读的摘要 */
  summary?: string;
  /** 关联正文文档 id */
  docId?: string;
  /** 关联时间线 id */
  timelineId?: string;
  /** 关联实体 id（伏笔/线索可挂实体） */
  entityIds?: string[];
  /** 伏笔标记：埋设 / 回收 */
  foreshadow?: { setup: boolean; payoff: boolean };
  createdAt: number;
  updatedAt: number;
}

export const OUTLINE_KIND_LABEL: Record<OutlineKind, string> = {
  arc: '篇章弧',
  volume: '卷',
  chapter: '章',
  scene: '场景',
  note: '笔记',
};

export const OUTLINE_STATUS_LABEL: Record<OutlineStatus, string> = {
  todo: '待写',
  drafting: '进行中',
  done: '已完成',
  paused: '暂停',
};

/** 默认节点类型（顶层新建时依次递进：弧 → 卷 → 章 → 场景） */
export const OUTLINE_KIND_ORDER: OutlineKind[] = ['arc', 'volume', 'chapter', 'scene', 'note'];
