// ============================================================
// 执行轨迹 Trace（Phase 1.5 · 借鉴 DeepSeek Harness Trajectory）
// ------------------------------------------------------------
// append-only 记录「模型看到的一切」：系统提示 / 思维链 / 工具调用与
// 结果 / 上下文注入 / 子 Agent 调度。独立侧车文件 fl-traces.json，
// 不膨胀世界数据。记录可开关（默认全记）。
//
// 分层：AILogPanel = 传输层（HTTP），Trace = 语义层（执行轨迹），
// 共用 runId 关联。
//
// 防膨胀：单 run 500 步截断（丢最旧）、run 数 200 上限、记录开关。
// 纯函数（createRun/pushStep/forkRun/…）独立可测；trace 单例负责
// 持久化与订阅（TracePanel 响应）。
// ============================================================

import type { AIModel } from '../../store/aiStore';

const TRACE_FILE = 'fl-traces.json';
const LS_KEY = 'fl-traces';
const MAX_STEPS = 500;
const MAX_RUNS = 200;

export type TraceSource =
  | 'chat' | 'extract' | 'linker' | 'scene' | 'template'
  | 'subagent' | 'propose' | 'material';

export type TraceStepKind =
  | 'user' | 'assistant' | 'reasoning' | 'tool_call' | 'tool_result'
  | 'context_inject' | 'subagent' | 'narrate' | 'system';

export interface TraceToolInfo {
  name: string;
  args?: unknown;
  result?: unknown;
  durationMs?: number;
  ok?: boolean;
}

export interface TraceStep {
  seq: number;
  ts: number;
  kind: TraceStepKind;
  /** 一行摘要（列表视图） */
  summary: string;
  /** 完整内容（展开：工具参数 / 结果 / 注入上下文） */
  detail?: string;
  tool?: TraceToolInfo;
  /** 子 Agent 调度时指向子 run */
  runId?: string;
}

export interface TraceRun {
  id: string;
  worldKey: string;
  sessionId?: string;
  /** 任务摘要（首条 user 消息截断） */
  title: string;
  source: TraceSource;
  modelId?: string;
  createdAt: number;
  updatedAt: number;
  /** 分叉溯源 */
  parentRunId?: string;
  forkFromStep?: number;
  steps: TraceStep[];
}

export interface TraceStoreData {
  version: 1;
  /** 记录开关（默认全记） */
  enabled: boolean;
  runs: TraceRun[];
}

/* ==================== 纯函数（可测） ==================== */

export function newTraceRun(input: {
  worldKey: string;
  source: TraceSource;
  title?: string;
  modelId?: string;
  sessionId?: string;
  parentRunId?: string;
  forkFromStep?: number;
}): TraceRun {
  const now = Date.now();
  return {
    id: `tr-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    worldKey: input.worldKey,
    source: input.source,
    title: input.title ?? '',
    modelId: input.modelId,
    sessionId: input.sessionId,
    parentRunId: input.parentRunId,
    forkFromStep: input.forkFromStep,
    createdAt: now,
    updatedAt: now,
    steps: [],
  };
}

/** 追加一步（seq 自动递增）；超出 MAX_STEPS 丢弃最旧步骤 */
export function pushStep(run: TraceRun, step: Omit<TraceStep, 'seq' | 'ts'>): TraceRun {
  const seq = run.steps.length;
  const next: TraceRun = {
    ...run,
    updatedAt: Date.now(),
    steps: [...run.steps, { ...step, seq, ts: Date.now() }],
  };
  if (next.steps.length > MAX_STEPS) next.steps = next.steps.slice(next.steps.length - MAX_STEPS);
  return next;
}

/** run 数量上限：保留最近 MAX_RUNS 个 */
export function trimRuns(runs: TraceRun[]): TraceRun[] {
  if (runs.length <= MAX_RUNS) return runs;
  return runs.slice(runs.length - MAX_RUNS);
}

/** 分叉是否允许从该步骤边界切出（user/assistant/tool_result/context_inject 后上下文完整） */
export function isForkableStep(kind: TraceStepKind): boolean {
  return kind === 'user' || kind === 'assistant' || kind === 'tool_result' || kind === 'context_inject';
}

/**
 * 分叉：复制 run 到 stepSeq（含）的事件前缀，生成新 run（parentRunId 溯源）。
 * 非分叉边界（reasoning/tool_call 中间态）或步数越界返回 null。
 */
export function forkRun(run: TraceRun, stepSeq: number, input: { worldKey: string; source: TraceSource; sessionId?: string }): TraceRun | null {
  const step = run.steps.find((s) => s.seq === stepSeq);
  if (!step || !isForkableStep(step.kind)) return null;
  const prefix = run.steps.filter((s) => s.seq <= stepSeq);
  const child = newTraceRun({ ...input, parentRunId: run.id, forkFromStep: stepSeq });
  child.steps = prefix.map((s) => ({ ...s })); // 拷贝事件前缀
  return child;
}

/** 分叉上下文字面：截断后的事件前缀摘要（供新 run 继续对话时注入） */
export function buildForkContext(run: TraceRun, stepSeq: number): string {
  const prefix = run.steps.filter((s) => s.seq <= stepSeq);
  const lines = prefix.map((s) => `[${s.kind}] ${s.summary}`);
  return lines.join('\n');
}

/* ==================== 单例（持久化 + 订阅） ==================== */

function api(): any {
  return typeof window !== 'undefined' ? (window as any).api : undefined;
}
function hasFS(): boolean {
  return !!(api() && typeof api().readFile === 'function');
}

let store: TraceStoreData = { version: 1, enabled: true, runs: [] };
let loaded = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const cb of listeners) cb();
}

function persist() {
  const payload = JSON.stringify(store);
  if (hasFS()) {
    try { api().writeFile(TRACE_FILE, payload); } catch { /* ignore */ }
  } else {
    try { localStorage.setItem(LS_KEY, payload); } catch { /* ignore */ }
  }
}

/** 节流持久化：变更密集时合并写盘 */
function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => { persistTimer = null; persist(); }, 300);
}

export const trace = {
  /** 启动时懒加载（boot 快照不含 traces，独立读侧车文件） */
  async init(): Promise<void> {
    if (loaded) return;
    loaded = true;
    let raw: string | null = null;
    if (hasFS()) {
      try { raw = await api().readFile(TRACE_FILE); } catch { raw = null; }
    } else {
      try { raw = localStorage.getItem(LS_KEY); } catch { raw = null; }
    }
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.runs)) {
          store = { version: 1, enabled: parsed.enabled !== false, runs: parsed.runs };
        }
      } catch { /* 损坏则从空开始（侧车文件可重建） */ }
    }
  },

  isEnabled(): boolean {
    return store.enabled;
  },
  setEnabled(v: boolean): void {
    if (store.enabled === v) return;
    store = { ...store, enabled: v };
    persist();
    notify();
  },

  list(worldKey?: string): TraceRun[] {
    const runs = worldKey ? store.runs.filter((r) => r.worldKey === worldKey) : store.runs;
    return [...runs].reverse(); // 新 → 旧
  },
  getRun(id: string): TraceRun | undefined {
    return store.runs.find((r) => r.id === id);
  },

  startRun(input: Parameters<typeof newTraceRun>[0]): string {
    if (!store.enabled) return '';
    const run = newTraceRun(input);
    store = { ...store, runs: trimRuns([...store.runs, run]) };
    schedulePersist();
    notify();
    return run.id;
  },

  /** 追加一步；run 不存在或开关关闭时静默忽略 */
  step(runId: string, step: Omit<TraceStep, 'seq' | 'ts'>): void {
    if (!store.enabled || !runId) return;
    const idx = store.runs.findIndex((r) => r.id === runId);
    if (idx < 0) return;
    const runs = [...store.runs];
    runs[idx] = pushStep(runs[idx], step);
    store = { ...store, runs };
    schedulePersist();
    notify();
  },

  finishRun(runId: string, title?: string): void {
    const idx = store.runs.findIndex((r) => r.id === runId);
    if (idx < 0) return;
    const runs = [...store.runs];
    runs[idx] = { ...runs[idx], title: title ?? runs[idx].title, updatedAt: Date.now() };
    store = { ...store, runs };
    schedulePersist();
    notify();
  },

  /** 分叉出新 run；失败（非边界/越界）返回 null */
  fork(runId: string, stepSeq: number, input: { worldKey: string; source: TraceSource; sessionId?: string }): string | null {
    const run = store.runs.find((r) => r.id === runId);
    if (!run) return null;
    const child = forkRun(run, stepSeq, input);
    if (!child) return null;
    store = { ...store, runs: trimRuns([...store.runs, child]) };
    schedulePersist();
    notify();
    return child.id;
  },

  clearAll(worldKey?: string): void {
    store = { ...store, runs: worldKey ? store.runs.filter((r) => r.worldKey !== worldKey) : [] };
    persist();
    notify();
  },

  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};
