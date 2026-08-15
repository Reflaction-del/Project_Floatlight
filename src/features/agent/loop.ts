// ============================================================
// Agent Loop / Planner（Phase 2 单 Agent 编排）
// ------------------------------------------------------------
// runAgentLoop（响应式）：基于 chatWithTools 的多轮工具调用循环，
// 系统提示注入世界认知快照，工具执行走注册表（pre/execute/post + Trace）。
// runPlanner（规划式）：先产出严格 JSON 计划 → 按序执行工具 → 汇总，
// 供「多步任务」指令（Phase 3 沙盘推演的地基）。
// ============================================================

import type { AIModel } from '../../store/aiStore';
import { chatWithTools, chatOnce, splitThinking } from '../../utils/ai';
import type { AIMessage } from '../../utils/ai';
import { buildToolContext } from './registry';
import { buildWorldSnapshot } from './snapshot';
import { trace } from './trace';
import { useWorldStore } from '../../store/worldStore';
import type { WorldData } from '../../store/worldStore';

export interface AgentLoopOptions {
  model: AIModel;
  world: WorldData;
  /** 对话历史（不含本次用户消息） */
  history: AIMessage[];
  userMessage: string;
  /** 关联的对话会话 id（Trace 溯源用） */
  sessionId?: string;
  /** 允许的工具名子集（空 = 全部注册工具） */
  tools?: string[];
  signal?: AbortSignal;
  /** 认知快照注入预算（默认 800 token；0 = 不注入） */
  snapshotBudget?: number;
  onToolCall?: (name: string, args: unknown) => void;
  onToolResult?: (name: string, result: string) => void;
}

export interface AgentLoopResult {
  text: string;
  toolCalls: number;
}

/** 系统提示：世界观认知 + 工具使用纪律（提案红线） */
export function buildAgentSystemPrompt(world: WorldData, snapshotBudget = 800): string {
  const base =
    '你是浮光世界观编辑器的创作协作者（Agent），服务于当前世界观。' +
    '你可以调用工具检索世界设定、扫描一致性、查看大纲与认知快照，' +
    '但「写操作」一律先以提案形式提出（新增实体/关系/大纲节点），等待用户确认，绝不直接改数据。';
  if (snapshotBudget <= 0) return base;
  const snap = buildWorldSnapshot(world, { tokenBudget: snapshotBudget, entityTopK: 15 });
  return snap.text ? `${base}\n\n—— 当前世界认知快照 ——\n${snap.text}` : base;
}

/** 响应式 Agent Loop：一次对话 = 模型可能连续调用多个工具后给出最终回答。
 * 自动接入执行轨迹采集（Trace）：user / context_inject / tool_call /
 * tool_result / assistant(reasoning 拆分)，记录开关关闭时零开销。 */
export async function runAgentLoop(opts: AgentLoopOptions): Promise<AgentLoopResult> {
  // —— Trace 采集（run 启动 + 首条 user + 上下文注入） ——
  const runId = trace.isEnabled()
    ? trace.startRun({
        worldKey: useWorldStore.getState().current,
        source: 'chat',
        sessionId: opts.sessionId,
        title: opts.userMessage.slice(0, 40),
        modelId: opts.model.id,
      })
    : '';
  if (runId) {
    trace.step(runId, { kind: 'user', summary: opts.userMessage.slice(0, 100), detail: opts.userMessage });
  }
  const systemPrompt = buildAgentSystemPrompt(opts.world, opts.snapshotBudget ?? 800);
  if (runId) {
    trace.step(runId, {
      kind: 'context_inject',
      summary: `注入世界认知快照（预算 ${opts.snapshotBudget ?? 800} token）`,
      detail: systemPrompt,
    });
  }

  let toolCalls = 0;
  const toolCtx = buildToolContext({
    world: opts.world,
    enabled: opts.tools,
    // 注意：Trace 回调必须在构造时传入（buildToolContext 闭包绑定），事后 spread 无效
    onToolCall: (name, args) => {
      toolCalls++;
      opts.onToolCall?.(name, args);
      if (runId) trace.step(runId, { kind: 'tool_call', summary: `调用工具 ${name}`, detail: JSON.stringify(args), tool: { name, args } });
    },
    onToolResult: (name, result) => {
      opts.onToolResult?.(name, result);
      if (runId) trace.step(runId, { kind: 'tool_result', summary: `工具 ${name} 返回 ${result.length} 字符`, detail: result.slice(0, 2000), tool: { name, result } });
    },
  });

  const seedMessages: AIMessage[] = [
    { role: 'system', content: systemPrompt },
    ...opts.history,
    { role: 'user', content: opts.userMessage },
  ];

  const text = await chatWithTools(opts.model, seedMessages, toolCtx, {
    signal: opts.signal,
    feature: 'chat',
    // 每轮模型产出 → trace（assistant 内容按思考/正文拆分）
    onTurn: (_turn, info) => {
      if (!runId) return;
      const { thinking, rest } = splitThinking(info.content);
      if (thinking) trace.step(runId, { kind: 'reasoning', summary: thinking.slice(0, 80), detail: thinking });
      if (rest) trace.step(runId, { kind: 'assistant', summary: rest.slice(0, 100), detail: rest });
    },
  });

  if (runId) {
    trace.step(runId, { kind: 'assistant', summary: text.slice(0, 100), detail: text });
    trace.finishRun(runId, opts.userMessage.slice(0, 40));
  }

  return { text, toolCalls };
}

/* ==================== Planner（规划式 loop 骨架） ==================== */

export interface PlanStep {
  tool: string;
  args: Record<string, unknown>;
  why: string;
}

export interface PlannerOptions {
  model: AIModel;
  world: WorldData;
  task: string;
  tools?: string[];
  signal?: AbortSignal;
  onToolCall?: (name: string, args: unknown) => void;
  onToolResult?: (name: string, result: string) => void;
}

export interface PlannerResult {
  plan: PlanStep[];
  results: string[];
  finalText: string;
}

const PLAN_RE = /\{[\s\S]*\}/;

/**
 * 规划式执行：模型产出严格 JSON 计划（steps 数组），按序执行工具，
 * 最后汇总一次模型调用。计划非法时降级为「直接回答」（无工具）。
 */
export async function runPlanner(opts: PlannerOptions): Promise<PlannerResult> {
  const toolCtx = buildToolContext({ world: opts.world, enabled: opts.tools });
  const toolNames = toolCtx.tools.map((t) => t.name).join('、');

  const planText = await chatOnce(opts.model, [
    { role: 'system', content: buildAgentSystemPrompt(opts.world, 800) },
    {
      role: 'user',
      content:
        `任务：${opts.task}\n\n` +
        `可用工具：${toolNames}\n` +
        '请先规划执行步骤，仅输出一个 JSON（不要多余文字）：{"steps":[{"tool":"工具名","args":{...},"why":"为何调用"}]}' +
        '。若无需工具即可回答，输出 {"steps":[]}。',
    },
  ], { signal: opts.signal, feature: 'chat' });

  let plan: PlanStep[] = [];
  try {
    const parsed = JSON.parse(PLAN_RE.exec(planText)?.[0] ?? '{}');
    plan = Array.isArray(parsed.steps) ? parsed.steps.filter((s: PlanStep) => s && s.tool) : [];
  } catch {
    plan = [];
  }

  const results: string[] = [];
  for (const step of plan) {
    opts.onToolCall?.(step.tool, step.args);
    const result = await toolCtx.callTool(step.tool, step.args ?? {});
    results.push(result);
    opts.onToolResult?.(step.tool, result);
  }

  // 汇总
  const finalText =
    results.length > 0
      ? await chatOnce(opts.model, [
          { role: 'system', content: buildAgentSystemPrompt(opts.world, 600) },
          {
            role: 'user',
            content:
              `任务：${opts.task}\n\n工具执行结果：\n${results.map((r, i) => `[步骤${i + 1}] ${r}`).join('\n\n')}\n\n` +
              '请基于以上结果给出最终回答（中文，简洁，可直接交付）。',
          },
        ], { signal: opts.signal, feature: 'chat' })
      : planText.replace(/```json|```/g, '').trim();

  return { plan, results, finalText };
}
