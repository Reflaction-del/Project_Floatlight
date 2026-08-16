// ============================================================
// SubAgent 运行时（Phase 3 多子代理）
// ------------------------------------------------------------
// 单步执行：选定角色（导演式=指定 / 沙盘式=轮换）→ 组装角色上下文
// （世界快照 + 人格词 + 记忆槽 + 最近事件 + 时间尺度 + 导演指令）→
// 一次 LLM 调用 → 事件追加 + 角色记忆槽更新 + Trace 采集。
//
// 设计要点：
// - 每角色可独立 modelId（默认当前模型）
// - 串行执行：一次只跑一步（pacing=auto 时由 UI 循环调用，可中断）
// - 一致性护栏：子代理只产出内容事件，不直接写库；写操作走提案
// - 依赖可注入（chatFn/getModel），便于单测与回放
// ============================================================

import type { AIModel } from '../../store/aiStore';
import { useAIStore } from '../../store/aiStore';
import { chatOnce, getCurrentModel } from '../../utils/ai';
import { buildWorldSnapshot } from '../agent/snapshot';
import { trace } from '../agent/trace';
import { useWorldStore } from '../../store/worldStore';
import {
  pushEvent,
  appendMemory,
  nextActor,
  recentEvents,
  buildActorContext,
} from './simOps';
import { SIM_TIME_UNIT_LABEL, type Simulation, type SubAgent, type SimEventKind } from './types';
import type { WorldData } from '../../store/worldStore';
import type { SimEvent } from './types';

/** 可注入依赖（单测用） */
export interface SimulationRuntimeDeps {
  chatFn?: (model: AIModel, messages: { role: string; content: string }[], opts?: { signal?: AbortSignal }) => Promise<string>;
  getModel?: (modelId?: string) => AIModel | null;
  onEvent?: (sim: Simulation, ev: SimEvent) => void;
}

export interface SimulationStepInput {
  world: WorldData;
  sim: Simulation;
  /** 导演式必填：指定角色 id */
  actorId?: string;
  /** 导演指令（directed 模式） */
  userDirective?: string;
  signal?: AbortSignal;
  /** 模拟专属轨迹 runId（UI 层创建；有则采集 subagent 步骤） */
  traceRunId?: string;
}

export interface SimulationStepResult {
  sim: Simulation;
  actor: SubAgent | null;
  event: SimEvent | null;
  error?: string;
}

function defaultGetModel(modelId?: string): AIModel | null {
  if (modelId) {
    const m = useAIStore.getState().models.find((x) => x.id === modelId);
    if (m) return m;
  }
  return getCurrentModel();
}

/** 行动内容 → 事件类型（启发式：对白/引号多为 speech，否则 action） */
export function classifyEventKind(content: string): SimEventKind {
  const t = content.trim();
  if (/^[“"]|^[「『]/.test(t) || (t.match(/[“"「『]/g) || []).length >= 2) return 'speech';
  return 'action';
}

/** 执行一步子代理行动；返回更新后的 Simulation（未改 store，由调用方落盘） */
export async function runSimulationStep(
  input: SimulationStepInput,
  deps: SimulationRuntimeDeps = {},
): Promise<SimulationStepResult> {
  const { world, sim, actorId, userDirective, signal } = input;
  const chatFn = deps.chatFn ?? chatOnce;
  const getModel = deps.getModel ?? defaultGetModel;

  // 确定角色
  let actor: SubAgent | null = null;
  if (sim.mode === 'directed') {
    actor = sim.actors.find((a) => a.id === actorId) ?? null;
    if (!actor) return { sim, actor: null, event: null, error: '导演式需指定有效角色' };
  } else {
    actor = nextActor(sim);
    if (!actor) return { sim, actor: null, event: null, error: '没有可行动的自主角色' };
  }

  const model = getModel(actor.modelId);
  if (!model) return { sim, actor, event: null, error: `角色「${actor.entityId}」未配置可用模型` };

  // 组装上下文
  const snap = buildWorldSnapshot(world, { tokenBudget: 1200, entityTopK: 12 });
  const timeScaleText = sim.timeScale
    ? `${sim.timeScale.span} ${SIM_TIME_UNIT_LABEL[sim.timeScale.unit]}`
    : '';
  const context = buildActorContext({
    actorName: actor.entityId,
    personaPrompt: actor.personaPrompt,
    memorySlot: actor.memorySlot,
    recent: recentEvents(sim),
    worldSnapshot: snap.text,
    timeScaleText,
    userDirective,
    directed: sim.mode === 'directed',
  });

  // LLM 调用（串行单步）
  const output = await chatFn(model, [
    { role: 'system', content: '你是世界观模拟中的一名角色。只输出角色的行动或对白，用第一人称，一段话即可，不要解释。' },
    { role: 'user', content: context },
  ], { signal });

  const content = (output || '').trim();
  if (!content) return { sim, actor, event: null, error: '模型未产出内容' };

  // 事件追加 + 记忆槽更新
  const evInput = { actor: actor.id, kind: classifyEventKind(content), content };
  let nextSim = pushEvent(sim, evInput);
  const event = nextSim.events[nextSim.events.length - 1];
  const updatedActor = appendMemory(actor, `[第${event.step}步] ${content.slice(0, 120)}`);
  nextSim = {
    ...nextSim,
    actors: nextSim.actors.map((a) => (a.id === actor.id ? updatedActor : a)),
    updatedAt: Date.now(),
  };

  // Trace 采集（subagent 事件；traceRunId 由 UI 层提供，无则跳过）
  if (trace.isEnabled() && input.traceRunId) {
    trace.step(input.traceRunId, {
      kind: 'subagent',
      summary: `角色「${actor.entityId}」行动`,
      detail: content,
      runId: undefined,
    });
  }

  deps.onEvent?.(nextSim, event);
  return { sim: nextSim, actor, event };
}

/** 沙盘自动连推 N 步（可中断；每步之间调用方负责落盘与渲染） */
export async function runSimulationSteps(
  input: SimulationStepInput & { steps: number },
  deps: SimulationRuntimeDeps = {},
  onStep?: (result: SimulationStepResult, index: number) => void,
): Promise<SimulationStepResult> {
  let result: SimulationStepResult = { sim: input.sim, actor: null, event: null };
  for (let i = 0; i < input.steps; i++) {
    if (input.signal?.aborted) break;
    result = await runSimulationStep(input, deps);
    onStep?.(result, i);
    if (!result.event || result.sim.status === 'ended') break; // 无事件（无角色/出错）或预算耗尽
    // 下一轮用更新后的 sim 继续
    input = { ...input, sim: result.sim };
  }
  return result;
}
