// ============================================================
// AI-GM 运行时（Phase 4a）
// ------------------------------------------------------------
// 一次玩家行动 → 规则判定（/roll 掷骰 /check 检定）→ GM 回应。
// GM 为子代理：规则书 meta + 世界快照 + 最近日志 + 玩家行动 →
// 生成场景描述与判定后的推进。依赖可注入（chatFn/getModel），便于单测。
//
// 玩家属性存 session.state[playerName] = { attrs: {...}, skills: {...} }
// （UI 可编辑；缺省视为 0）。
// ============================================================

import type { AIModel } from '../../store/aiStore';
import { useAIStore } from '../../store/aiStore';
import { chatOnce, getCurrentModel } from '../../utils/ai';
import { buildWorldSnapshot } from '../agent/snapshot';
import { trace } from '../agent/trace';
import { rollDice, evaluateFormula, checkDifficulty, describeRoll } from './rules';
import type { Rulebook, TTRPGSession, SessionTurn } from './types';

export interface GMRuntimeDeps {
  chatFn?: (model: AIModel, messages: { role: string; content: string }[], opts?: { signal?: AbortSignal }) => Promise<string>;
  getModel?: (modelId?: string) => AIModel | null;
}

export interface GMActionInput {
  session: TTRPGSession;
  rulebook: Rulebook;
  world: import('../../store/worldStore').WorldData;
  /** 玩家行动文本；/roll 与 /check 开头为规则指令 */
  action: string;
  playerName: string;
  /** GM 专属模型（空 = 当前模型） */
  gmModelId?: string;
  signal?: AbortSignal;
  /** 模拟专属轨迹 runId（可选） */
  traceRunId?: string;
}

export interface GMActionResult {
  session: TTRPGSession;
  /** 规则判定 turn（/roll 或 /check 时） */
  roll?: SessionTurn;
  /** GM 回应 turn（自由行动时） */
  gm?: SessionTurn;
  error?: string;
}

/** 解析 /check 指令：/check 技能 [难度] 或 /check 技能 [dc] */
export function parseCheckCommand(text: string): { skill: string; difficultyKey?: string; dc?: number } | null {
  const m = /^\/check\s+(.+)$/i.exec(text.trim());
  if (!m) return null;
  const rest = m[1].trim();
  const parts = rest.split(/\s+/);
  const skill = parts[0];
  const second = parts[1];
  if (!skill) return null;
  if (!second) return { skill };
  if (/^\d+$/.test(second)) return { skill, dc: parseInt(second, 10) };
  return { skill, difficultyKey: second };
}

/** 难度别名：中文 ↔ 骨架英文 key */
const DIFFICULTY_ALIAS: Record<string, string> = {
  简单: 'easy', 普通: 'normal', 困难: 'hard', 极难: 'veryHard', 常规成功: 'normal', 困难成功: 'hard', 极难成功: 'veryHard',
};
function resolveDifficultyKey(key: string | undefined): string {
  return DIFFICULTY_ALIAS[key ?? ''] ?? key ?? 'normal';
}

/** 技能名模糊匹配规则书（包含/忽略空格） */
export function matchSkill(rulebook: Rulebook, name: string): Rulebook['skills'][number] | null {
  const n = name.trim().toLowerCase();
  return (
    rulebook.skills.find((s) => s.name.toLowerCase() === n) ??
    rulebook.skills.find((s) => s.name.toLowerCase().includes(n) || n.includes(s.name.toLowerCase())) ??
    null
  );
}

/** 取玩家属性/技能值（缺省 0） */
export function playerStat(session: TTRPGSession, playerName: string, kind: 'attrs' | 'skills', key: string): number {
  const p = session.state[playerName] as { attrs?: Record<string, number>; skills?: Record<string, number> } | undefined;
  const v = p?.[kind]?.[key];
  return typeof v === 'number' ? v : 0;
}

/** GM 提示词组装（纯函数） */
export function buildGMPrompt(input: {
  rulebook: Rulebook;
  worldSnapshot: string;
  recentLog: SessionTurn[];
  playerName: string;
  action: string;
  rollDetail?: string;
  gmName: string;
}): { system: string; user: string } {
  const recent = input.recentLog.slice(-8).map((t) => `[${t.kind}] ${t.who}：${t.content}`).join('\n');
  return {
    system:
      `你是跑团主持人（GM）「${input.gmName}」，主持规则体系：${input.rulebook.name}。\n` +
      `【规则说明】${input.rulebook.meta || '（无）'}\n` +
      `【检定公式】${input.rulebook.formula}；难度表：${Object.entries(input.rulebook.difficulty).map(([k, v]) => `${k}=${v}`).join(', ')}\n` +
      `【世界观背景】\n${input.worldSnapshot || '（世界为空）'}\n` +
      '你的职责：描述场景、裁决玩家行动、推进剧情。检定结果以「/roll 或 /check 已执行」为准，直接给出剧情后果。' +
      '保持角色沉浸与世界观一致性；用中文回复；一段或两段话即可，不要解释机制。',
    user:
      `最近回合：\n${recent || '（开局，可先描述开场场景）'}\n\n` +
      `玩家「${input.playerName}」行动：${input.action}\n` +
      (input.rollDetail ? `本次判定：${input.rollDetail}\n` : ''),
  };
}

/** 执行玩家一次行动（/roll、/check 或自由行动 + GM 回应） */
export async function runGMAction(input: GMActionInput, deps: GMRuntimeDeps = {}): Promise<GMActionResult> {
  const { session, rulebook, world, action, playerName, signal, traceRunId } = input;
  const chatFn = deps.chatFn ?? chatOnce;
  const getModel = deps.getModel ?? ((modelId?: string) => {
    if (modelId) {
      const m = useAIStore.getState().models.find((x) => x.id === modelId);
      if (m) return m;
    }
    return getCurrentModel();
  });

  const trimmed = action.trim();
  type TurnInput = Omit<SessionTurn, 'id' | 'ts'>;
  const turns: TurnInput[] = [];

  // 1) 玩家行动回合（自由文本或指令原文）
  turns.push({ kind: 'player', who: playerName, content: trimmed.slice(0, 500) });

  // 2) 规则判定
  let rollTurn: TurnInput | undefined;
  let rollDetail: string | undefined;
  if (/^\/roll\b/i.test(trimmed)) {
    const expr = trimmed.replace(/^\/roll\b/i, '').trim() || rulebook.dice;
    const d = describeRoll(expr);
    if (d) {
      rollDetail = d;
      rollTurn = { kind: 'roll', who: playerName, content: `掷骰 ${expr}`, detail: d };
      turns.push(rollTurn);
    }
  } else if (/^\/check\b/i.test(trimmed)) {
    const cmd = parseCheckCommand(trimmed);
    const skill = cmd ? matchSkill(rulebook, cmd.skill) : null;
    if (!cmd || !skill) {
      rollTurn = { kind: 'system', who: '系统', content: `未知技能「${cmd?.skill ?? ''}」，可用技能：${rulebook.skills.map((s) => s.name).join('、')}` };
      turns.push(rollTurn);
    } else {
      const statVal = playerStat(session, playerName, 'attrs', skill.base);
      const skillVal = playerStat(session, playerName, 'skills', skill.name);
      const r = evaluateFormula(rulebook.formula, {
        attr: { [skill.base]: statVal },
        skill: { [skill.name]: skillVal },
      });
      const dc = cmd.dc ?? rulebook.difficulty[resolveDifficultyKey(cmd.difficultyKey)] ?? 10;
      const passed = r.total >= dc;
      const succ = rulebook.formula.includes('<=') ? r.success : passed;
      rollDetail = `${r.detail}｜${skill.name} 检定（难度 ${dc}）→ ${succ ? '成功' : '失败'}`;
      rollTurn = { kind: 'roll', who: playerName, content: `检定 ${skill.name}`, detail: rollDetail };
      turns.push(rollTurn);
    }
  }

  // 3) GM 回应（自由行动或判定后推进；纯指令则仍让 GM 描述结果）
  const model = getModel(input.gmModelId);
  if (model) {
    const snap = buildWorldSnapshot(world, { tokenBudget: 1000, entityTopK: 10 });
    const { system, user } = buildGMPrompt({
      rulebook, worldSnapshot: snap.text, recentLog: session.log, playerName, action: trimmed, rollDetail, gmName: session.gmName,
    });
    try {
      const gmText = await chatFn(model, [{ role: 'system', content: system }, { role: 'user', content: user }], { signal });
      const gmTurn: TurnInput = { kind: 'gm', who: session.gmName, content: (gmText || '').trim().slice(0, 1000) };
      if (gmTurn.content) {
        turns.push(gmTurn);
        // Trace 采集（GM 子代理行动）
        if (trace.isEnabled() && traceRunId) {
          trace.step(traceRunId, { kind: 'subagent', summary: `GM「${session.gmName}」回应`, detail: gmTurn.content });
        }
      }
    } catch (e: any) {
      if (String(e?.message ?? e).includes('aborted')) return { session, roll: undefined, gm: undefined };
      turns.push({ kind: 'system', who: '系统', content: `（GM 响应失败：${e?.message ?? e}）` });
    }
  }

  const now = Date.now();
  const logTurns: SessionTurn[] = turns.map((t, i) => ({
    ...t, id: `tn-${now.toString(36)}-${i}-${Math.random().toString(36).slice(2, 5)}`, ts: now + i,
  }));
  return {
    session: { ...session, log: [...session.log, ...logTurns], updatedAt: Date.now() },
    roll: rollTurn ? logTurns.find((t) => t.kind === rollTurn!.kind && t.who === rollTurn!.who && t.content === rollTurn!.content) : undefined,
    gm: logTurns.find((t) => t.kind === 'gm'),
  };
}
