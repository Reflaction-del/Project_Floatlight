// ============================================================
// 模拟操作纯函数（Phase 3，便于单测与运行时复用）
// ------------------------------------------------------------
// newSimulation / pushEvent / nextActor（沙盘轮换）/ appendMemory（记忆槽
// 裁剪）/ recentEvents / buildActorContext（角色上下文拼装）/ nextEventId。
// ============================================================

import type { SubAgent, Simulation, SimEvent, SimEventKind } from './types';

export const MEMORY_SLOT_MAX = 10;
export const DEFAULT_STEP_BUDGET = 40;
export const DEFAULT_AUTO_STEPS = 5;

export function newSimulation(input: {
  mode: Simulation['mode'];
  title: string;
  scenario: string;
  actors: SubAgent[];
  pacing?: Simulation['pacing'];
  autoSteps?: number;
  timeScale?: Simulation['timeScale'];
  stepBudget?: number;
}): Simulation {
  const now = Date.now();
  return {
    id: `sim-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    mode: input.mode,
    title: input.title || '未命名模拟',
    scenario: input.scenario,
    actors: input.actors,
    events: [],
    pacing: input.pacing ?? 'step',
    autoSteps: input.autoSteps ?? DEFAULT_AUTO_STEPS,
    timeScale: input.timeScale,
    stepBudget: input.stepBudget ?? DEFAULT_STEP_BUDGET,
    status: 'running',
    createdAt: now,
    updatedAt: now,
  };
}

export function nextEventId(sim: Simulation): string {
  return `ev-${sim.id.slice(4)}-${sim.events.length}-${Math.random().toString(36).slice(2, 5)}`;
}

/** 追加事件（step 自动递增；超过 stepBudget 时标记 ended） */
export function pushEvent(sim: Simulation, input: { actor: string; kind: SimEventKind; content: string }): Simulation {
  const step = sim.events.length;
  const event: SimEvent = {
    id: nextEventId(sim),
    ts: Date.now(),
    step,
    actor: input.actor,
    kind: input.kind,
    content: input.content,
  };
  const overBudget = step + 1 >= sim.stepBudget;
  return {
    ...sim,
    events: [...sim.events, event],
    status: overBudget ? 'ended' : sim.status,
    updatedAt: Date.now(),
  };
}

/** 沙盘轮换：下一个应行动的自主角色（跳过 on-command/已结束） */
export function nextActor(sim: Simulation): SubAgent | null {
  if (sim.actors.length === 0) return null;
  if (sim.mode === 'directed') return null; // 导演式由用户指定
  // 从最近一次行动的 actor 之后轮换，保持均衡
  const last = sim.events[sim.events.length - 1];
  const autonomous = sim.actors.filter((a) => a.strategy === 'autonomous');
  if (autonomous.length === 0) return null;
  const lastIdx = last ? autonomous.findIndex((a) => a.id === last.actor) : -1;
  return autonomous[(lastIdx + 1) % autonomous.length];
}

/** 记忆槽追加（超限丢最旧） */
export function appendMemory(agent: SubAgent, text: string): SubAgent {
  const next = [...agent.memorySlot, text];
  return { ...agent, memorySlot: next.length > MEMORY_SLOT_MAX ? next.slice(next.length - MEMORY_SLOT_MAX) : next };
}

/** 最近 N 条事件（供角色上下文窗口） */
export function recentEvents(sim: Simulation, n = 8): SimEvent[] {
  return sim.events.slice(-n);
}

/** 组装角色上下文（世界快照段 + 角色卡 + 记忆槽 + 最近事件 + 行动指令），纯拼接可测 */
export function buildActorContext(input: {
  actorName: string;
  personaPrompt: string;
  memorySlot: string[];
  recent: SimEvent[];
  worldSnapshot: string;
  timeScaleText: string;
  userDirective?: string;
  directed: boolean;
}): string {
  const parts: string[] = [];
  parts.push(`【你的身份】你正在扮演角色「${input.actorName}」。`);
  if (input.personaPrompt) parts.push(`【人格与目标】${input.personaPrompt}`);
  if (input.worldSnapshot) parts.push(`【世界观背景】\n${input.worldSnapshot}`);
  if (input.memorySlot.length) parts.push(`【你的经历记忆】\n${input.memorySlot.map((m, i) => `${i + 1}. ${m}`).join('\n')}`);
  if (input.recent.length) {
    parts.push(
      `【最近发生的事】\n${input.recent.map((e) => `- ${e.actor === input.actorName ? '你' : e.actor}（${e.kind}）：${e.content.slice(0, 200)}`).join('\n')}`,
    );
  }
  if (input.timeScaleText) parts.push(`【时间尺度】本次推演覆盖：${input.timeScaleText}。`);
  if (input.userDirective) parts.push(`【导演指令】${input.userDirective}`);
  parts.push(
    input.directed
      ? '请根据指令，以角色的身份用第一人称说出你的行动或对白（一段话，可含动作描写，不要解释）。'
      : '请根据当前情境自主决定下一步行动（一段话：动作或对白，第一人称，不要解释、不要问问题）。',
  );
  return parts.join('\n\n');
}
