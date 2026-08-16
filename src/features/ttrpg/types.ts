// ============================================================
// 跑团（Phase 4a）
// ------------------------------------------------------------
// Rulebook：规则书（内置骨架 + 用户 .fugurule 导入），技能检定公式可编辑。
// TTRPGSession：一次跑团会话（AI-GM / 全自动），lan? 字段为 LAN 多人预留。
// SessionTurn：回合日志（GM 描述 / 玩家行动 / 判定结果）。
// ============================================================

/** 技能定义：name + 关联属性 */
export interface SkillDef {
  name: string;
  base: string;
}

/** 规则书 */
export interface Rulebook {
  id: string;
  name: string;
  /** 世界观框架：dnd5e / coc7 / cyberpunk-red / custom */
  universe?: string;
  /** 默认骰子表达式，如 1d20 / 1d100 */
  dice: string;
  /** 属性列表 */
  stats: string[];
  /** 技能 + 关联属性 */
  skills: SkillDef[];
  /** 技能检定公式（用户可编辑）：如 1d20+{attr}+{skill} / 1d100<=({skill}*5) */
  formula: string;
  /** 难度阈值表 */
  difficulty: Record<string, number>;
  /** 规则说明（供 GM 提示词使用） */
  meta: string;
  createdAt?: number;
  updatedAt?: number;
}

/** 回合类型 */
export type TurnKind = 'gm' | 'player' | 'roll' | 'system';

/** 回合日志条目 */
export interface SessionTurn {
  id: string;
  ts: number;
  kind: TurnKind;
  /** 玩家/角色名（kind=roll 时为掷骰者） */
  who: string;
  content: string;
  /** 判定详情（kind=roll 时） */
  detail?: string;
}

/** 会话模式：ai-gm=AI 主持；auto=全自动（GM+NPC 全子代理） */
export type TTRPGMode = 'ai-gm' | 'auto';

/** 玩家 */
export interface SessionPlayer {
  name: string;
  /** 关联角色实体（可选） */
  actorId?: string;
  /** LAN 远程玩家（Phase 4b 预留） */
  isRemote?: boolean;
  /** 角色状态（HP 等，由玩家/GM 维护） */
  state: Record<string, number | string>;
}

/** LAN 房间信息（Phase 4b 预留） */
export interface LanRoomInfo {
  roomCode: string;
  token: string;
  port: number;
  /** 远程已加入玩家数 */
  remoteCount?: number;
}

/** 一次跑团会话 */
export interface TTRPGSession {
  id: string;
  mode: TTRPGMode;
  title: string;
  rulebookId: string;
  /** GM 关联角色（ai-gm 时可为叙事者） */
  gmName: string;
  players: SessionPlayer[];
  /** 回合日志（append-only） */
  log: SessionTurn[];
  /** 会话状态（场景/进度/道具等） */
  state: Record<string, unknown>;
  lan?: LanRoomInfo;
  createdAt: number;
  updatedAt: number;
}

export const TTRPG_MODE_LABEL: Record<TTRPGMode, string> = {
  'ai-gm': 'AI 主持',
  auto: '全自动',
};
