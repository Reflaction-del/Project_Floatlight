// ============================================================
// AI 提案队列 + 对话持久化 基础类型（Phase 0）
// ------------------------------------------------------------
// 所有 AI 辅助功能（文章抽取 / 实体关联 / 多模态设卡 / NL 建模板 /
// 物料字段补全）的产出统一经「提案队列」落库，由用户在「提案中心」
// 逐条采纳或拒绝，避免 AI 直接改写用户数据。
// ============================================================

import type { WikiEntity, RelationType } from '../types';
import type { MaterialTemplate } from '../features/materials/types';
import type { AIMessage } from '../utils/ai';

/** 提案来源（用于提案中心分组与标识） */
export type ProposalSource =
  | 'article' // 功能1：文章抽取实体/关系
  | 'material' // 物料字段 AI 补全
  | 'linker' // 功能3：实体名称关联
  | 'scene' // 功能2：多模态设卡（图片→实体卡）
  | 'template-gen' // 功能5：NL 创建模板
  | 'manual' // 手动
  | 'chat'; // 对话中直接发起的修改

/** addEntity 提案的实体输入（对齐 worldStore.addEntity 入参） */
export type NewEntityInput = {
  type: WikiEntity['type'];
  name: string;
  emoji?: string;
  fields?: WikiEntity['fields'];
  custom?: WikiEntity['custom'];
  tags?: WikiEntity['tags'];
  note?: string;
  images?: WikiEntity['images'];
  coverImageId?: string;
  /** 视觉物料生成器：通用字段（按 key 映射，供模板 customField 绑定） */
  materialFields?: WikiEntity['materialFields'];
  /** 视觉物料生成器：头像三模式 */
  portrait?: WikiEntity['portrait'];
  /** 视觉物料生成器：可见光条主色 */
  spectrumColor?: string;
  id?: string;
};

/** 提案要执行的原子操作 */
export type ProposalOp =
  | { kind: 'addEntity'; entity: NewEntityInput }
  | { kind: 'addRelation'; source: string; target: string; type: RelationType; label?: string }
  | { kind: 'updateEntity'; entityId: string; patch: Partial<WikiEntity> }
  | { kind: 'addTemplate'; template: MaterialTemplate };

export type ProposalStatus = 'pending' | 'accepted' | 'rejected';

/** 单条提案 */
export interface Proposal {
  id: string;
  source: ProposalSource;
  /** 来源可读标签（覆盖默认映射时用） */
  sourceLabel?: string;
  createdAt: number;
  op: ProposalOp;
  status: ProposalStatus;
  /** 给用户看的一行摘要（如「新增角色：林夜」） */
  summary: string;
}

/** 持久化的对话会话（功能4：对话记录落盘） */
export interface ChatSession {
  id: string;
  title: string;
  modelId?: string;
  messages: AIMessage[];
  createdAt: number;
  updatedAt: number;
}

export const PROPOSAL_SOURCE_LABEL: Record<ProposalSource, string> = {
  article: '文章抽取',
  material: '物料字段',
  linker: '实体关联',
  scene: '多模态设卡',
  'template-gen': '模板生成',
  manual: '手动',
  chat: '对话',
};
