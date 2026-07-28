import type { EntityPortrait } from './features/materials/types';

export type ThemeMode = 'light' | 'dark' | 'warm' | 'blue' | 'system';
export type ModuleKey =
  | 'editor'
  | 'timeline'
  | 'materials'
  | 'drafts'
  | 'settings'
  | 'entities'
  | 'relations'
  | 'consistency'
  | 'share';

export type WikiElementType =
  | 'character'
  | 'location'
  | 'item'
  | 'faction'
  | 'concept'
  | 'document';

export interface WikiElement {
  id: string;
  name: string;
  type: WikiElementType;
}

export interface DocFile {
  id: string;
  title: string;
  icon: string;
  /** 文件树分组（文件夹名） */
  folder: string;
  /** TipTap JSON 内容（可移植格式） */
  content: unknown;
}

export interface TimelineEvent {
  id: string;
  label: string;
  /** 在轴上的定位年份（可为负数） */
  year: number;
  note?: string;
  color?: string;
  /** 影响力指数 0-100，决定时间轴上的圆点大小 */
  impact?: number;
  /** 关联的实体 id。一个实体可拥有多个时间轴节点（1:N）。 */
  entityId?: string;
}

export type TimelineUnit = 'year' | 'month' | 'day' | 'custom';

export interface Timeline {
  id: string;
  name: string;
  events: TimelineEvent[];
  /** 事件单位（时间尺度标签） */
  unit?: TimelineUnit;
  /** 自定义单位文案（unit === 'custom' 时使用） */
  unitLabel?: string;
}

/** 文件树选中项（用于右键菜单的删除等操作） */
export type TreeSelection =
  | { kind: 'doc'; id: string }
  | { kind: 'folder'; id: string }
  | { kind: 'timeline'; id: string };

/** 中间区标签页 */
export interface TabItem {
  id: string;
  title: string;
  icon?: string;
  kind: 'doc' | 'module' | 'timeline' | 'drafts' | 'entity' | 'start';
  /** doc => 文档 id；module => ModuleKey；timeline => 时间轴 id；entity => 实体 id */
  ref: string;
}

/* ============================================================
 * M1 五类实体（角色/势力/地点/事件/规则）
 * 时间线节点已改为时间轴事件，不再作为实体类型存在
 * ============================================================ */
export type EntityType = 'character' | 'faction' | 'location' | 'event' | 'rule';

export interface EntityField {
  label: string;
  value: string;
  /** 字段类型：文本 或 实体引用 */
  kind?: 'text' | 'entity';
  /** 当 kind='entity' 时，可选择的实体类型（为空表示全部类型） */
  entityType?: EntityType[];
}

export interface WikiEntity {
  id: string;
  type: EntityType;
  name: string;
  /** 结构化模板字段（按类型预置，用户可改值） */
  fields: EntityField[];
  /** 用户自定义字段（M1-2） */
  custom: { label: string; value: string }[];
  /** 标签（用于过滤与一致性互斥判断） */
  tags: string[];
  /** 备注（自由文本） */
  note?: string;
  /** M7-3 实体级评论 */
  comments?: EntityComment[];
  /** M7-3 版本历史（可回滚） */
  versions?: EntityVersion[];
  /** 实体插图（M1） */
  images?: EntityImage[];
  /** 实体卡片封面图 id，默认取 images[0] */
  coverImageId?: string;
  /* —— 视觉物料生成器（P0）扩展，均为可选，旧数据兼容 —— */
  /** 物料头像：三模式（实体库插图 / 用户上传 / AI 生成），见 EntityPortrait */
  portrait?: EntityPortrait;
  /** 可见光条主色（HRI 风格可视化条，如 '#3aa0ff'） */
  spectrumColor?: string;
  /** 物料通用字段：按 key 映射，供模板 FieldBinding.source='customField' 引用（用户决策 #3） */
  materialFields?: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

/** 实体插图 */
export interface EntityImage {
  id: string;
  /** 图片 dataURL（桌面版由 open-image 返回 base64） */
  dataUrl: string;
  name?: string;
  createdAt: number;
}
/** 实体评论（M7-3） */
export interface EntityComment {
  id: string;
  author: string;
  content: string;
  ts: number;
}

/** 实体版本快照（M7-3，仅保存可回滚的核心字段） */
export interface EntityVersion {
  version: number;
  ts: number;
  snapshot: Pick<WikiEntity, 'name' | 'type' | 'fields' | 'custom' | 'tags' | 'note' | 'images' | 'coverImageId'>;
}

/** 五类实体的录入模板（最小可用字段集，M1-1） */
export interface EntityTemplate {
  type: EntityType;
  label: string;
  /** 可选图标标识（已弃用 emoji，留空以使用类型色块） */
  icon?: string;
  /** 预置结构化字段 */
  fields: { label: string; placeholder?: string; kind?: 'text' | 'entity'; entityType?: EntityType[] }[];
}

export const ENTITY_TEMPLATES: EntityTemplate[] = [
  { type: 'character', label: '角色', fields: [
    { label: '身份' }, { label: '阵营', kind: 'entity', entityType: ['faction', 'location'] }, { label: '年龄' }, { label: '外貌' }, { label: '性格' }, { label: '动机' }, { label: '经历' },
  ] },
  { type: 'faction', label: '势力', fields: [
    { label: '性质' }, { label: '领袖' }, { label: '据点' }, { label: '信条' }, { label: '势力范围' },
  ] },
  { type: 'location', label: '地点', fields: [
    { label: '类型' }, { label: '坐标' }, { label: '统治者' }, { label: '气候' }, { label: '风俗' },
  ] },
  { type: 'event', label: '事件', fields: [
    { label: '时间' }, { label: '参与方' }, { label: '起因' }, { label: '结果' },
  ] },
  { type: 'rule', label: '规则', fields: [
    { label: '领域' }, { label: '内容' }, { label: '例外' },
  ] },
];

export const ENTITY_LABEL: Record<EntityType, string> = {
  character: '角色', faction: '势力', location: '地点', event: '事件', rule: '规则',
};

/* ============================================================
 * M2 关系（实体间带类型的关系）
 * ============================================================ */
export type RelationType = 'belongs' | 'enemy' | 'occurs' | 'causal' | 'kin' | 'custom';

export interface WikiRelation {
  id: string;
  source: string; // 源实体 id
  target: string; // 目标实体 id
  type: RelationType;
  /** 可选自定义标签（如关系说明） */
  label?: string;
  createdAt?: number;
}

export const RELATION_LABEL: Record<RelationType, string> = {
  belongs: '隶属', enemy: '敌对', occurs: '发生于', causal: '因果', kin: '亲缘', custom: '自定义',
};

/** 应对称的关系类型（M3 对称规则用） */
export const SYMMETRIC_RELATIONS: RelationType[] = ['kin', 'enemy'];

/* ============================================================
 * M3 一致性引擎
 * ============================================================ */
export type ConflictSeverity = 'strong' | 'weak';

export interface Conflict {
  id: string;
  ruleId: string;
  ruleName: string;
  severity: ConflictSeverity;
  message: string;
  /** 涉及的实体 id，点击可跳转 */
  entityIds: string[];
}
