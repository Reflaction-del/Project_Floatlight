// ============================================================
// 角色模拟（Phase 3 多子代理）
// ------------------------------------------------------------
// Simulation = 一次「沙盘/导演式」角色模拟会话：多个 SubAgent 基于
// 世界观与角色卡推进事件流。数据存 WorldData.simulations。
//
// SubAgent：角色卡(entityId) + 人格提示词(用户可编辑) + 专属记忆槽 +
// 行动策略（autonomous 自主 / on-command 待指令）+ 每角色独立模型。
// 观察式沙盘：角色按序自主行动；导演式：仅用户指令的角色行动。
// ============================================================

/** 角色扮演角色 */
export type SimRole = 'protagonist' | 'npc' | 'gm' | 'player';

/** 行动策略：autonomous=观察式自主行动；on-command=导演式等待指令 */
export type SimStrategy = 'autonomous' | 'on-command';

/** 模拟模式：sandbox=观察式沙盘；directed=导演式精控 */
export type SimMode = 'sandbox' | 'directed';

/** 推进节奏：step=每步确认；auto=自动连推 N 步 */
export type SimPacing = 'step' | 'auto';

/** 事件类型 */
export type SimEventKind = 'action' | 'speech' | 'narrate' | 'system';

/** 时间尺度单位 */
export type SimTimeUnit = 'day' | 'week' | 'month' | 'year';

/** 单角色代理实例 */
export interface SubAgent {
  id: string;
  /** 角色卡实体 id（复用 WikiEntity） */
  entityId: string;
  role: SimRole;
  /** 扮演指令（用户可在沙盘视图直接编辑） */
  personaPrompt: string;
  /** 专属经历记忆槽（回合追加，超限丢最旧） */
  memorySlot: string[];
  strategy: SimStrategy;
  /** 每角色可单独选择模型；空 = 用当前模型 */
  modelId?: string;
}

/** 单条模拟事件（append-only） */
export interface SimEvent {
  id: string;
  ts: number;
  /** 递增步数 */
  step: number;
  /** actor id | 'narrator'（叙事者）| 'system' | 'user' */
  actor: string;
  kind: SimEventKind;
  content: string;
}

/** 时间尺度推演：指定推演一个时间周期内发生的事 */
export interface SimTimeScale {
  unit: SimTimeUnit;
  span: number;
}

export type SimStatus = 'running' | 'paused' | 'ended';

/** 一次模拟会话 */
export interface Simulation {
  id: string;
  mode: SimMode;
  title: string;
  /** 初始场景描述（叙事者开场） */
  scenario: string;
  actors: SubAgent[];
  events: SimEvent[];
  /** step=每步确认；auto=自动连推 */
  pacing: SimPacing;
  /** pacing='auto' 时连推步数（默认 5） */
  autoSteps: number;
  /** 时间尺度推演（可选） */
  timeScale?: SimTimeScale;
  /** 观察式最大步数（防失控） */
  stepBudget: number;
  status: SimStatus;
  createdAt: number;
  updatedAt: number;
}

export const SIM_MODE_LABEL: Record<SimMode, string> = {
  sandbox: '观察式沙盘',
  directed: '导演式',
};

export const SIM_PACING_LABEL: Record<SimPacing, string> = {
  step: '每步确认',
  auto: '自动连推',
};

export const SIM_ROLE_LABEL: Record<SimRole, string> = {
  protagonist: '主角',
  npc: 'NPC',
  gm: '主持人',
  player: '玩家',
};

export const SIM_EVENT_LABEL: Record<SimEventKind, string> = {
  action: '行动',
  speech: '对话',
  narrate: '叙事',
  system: '系统',
};

export const SIM_TIME_UNIT_LABEL: Record<SimTimeUnit, string> = {
  day: '天',
  week: '周',
  month: '月',
  year: '年',
};
