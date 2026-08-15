// ============================================================
// features/agent/trace.ts 单元测试（纯函数部分）
// 守护：newTraceRun / pushStep（seq 递增 + 500 步截断）/ trimRuns /
// isForkableStep / forkRun（边界校验 + 前缀复制 + 溯源）/ buildForkContext。
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  newTraceRun,
  pushStep,
  trimRuns,
  isForkableStep,
  forkRun,
  buildForkContext,
} from './trace';
import type { TraceRun, TraceStepKind } from './trace';

const base = { worldKey: 'w1', source: 'chat' as const };

function runWithSteps(kinds: TraceStepKind[]): TraceRun {
  let run = newTraceRun({ ...base, title: '测试任务' });
  kinds.forEach((kind, i) => {
    run = pushStep(run, { kind, summary: `步骤${i}` });
  });
  return run;
}

describe('newTraceRun / pushStep', () => {
  it('生成 run 并 seq 从 0 递增', () => {
    const run = newTraceRun(base);
    expect(run.steps).toHaveLength(0);
    const r1 = pushStep(run, { kind: 'user', summary: '你好' });
    const r2 = pushStep(r1, { kind: 'assistant', summary: '回复' });
    expect(r2.steps.map((s) => s.seq)).toEqual([0, 1]);
    expect(r2.updatedAt).toBeGreaterThanOrEqual(r1.updatedAt);
  });

  it('超过 500 步丢弃最旧', () => {
    let run = newTraceRun(base);
    for (let i = 0; i < 520; i++) run = pushStep(run, { kind: 'system', summary: `s${i}` });
    expect(run.steps).toHaveLength(500);
    expect(run.steps[0].summary).toBe('s20'); // 最旧的 s0..s19 被丢
  });
});

describe('trimRuns', () => {
  it('超过 200 个 run 保留最近 200', () => {
    const runs = Array.from({ length: 250 }, (_, i) => ({ ...newTraceRun(base), title: `r${i}` }));
    expect(trimRuns(runs)).toHaveLength(200);
    expect(trimRuns(runs)[0].title).toBe('r50');
  });
});

describe('isForkableStep', () => {
  it('仅 user/assistant/tool_result/context_inject 可分叉', () => {
    for (const k of ['user', 'assistant', 'tool_result', 'context_inject'] as const) {
      expect(isForkableStep(k), k).toBe(true);
    }
    for (const k of ['reasoning', 'tool_call', 'system', 'narrate', 'subagent'] as const) {
      expect(isForkableStep(k), k).toBe(false);
    }
  });
});

describe('forkRun', () => {
  it('在合法边界分叉：前缀复制 + parentRunId/forkFromStep 溯源', () => {
    const run = runWithSteps(['user', 'assistant', 'tool_call', 'tool_result', 'assistant']);
    const child = forkRun(run, 3, { ...base, sessionId: 's1' }); // tool_result 边界
    expect(child).not.toBeNull();
    expect(child!.parentRunId).toBe(run.id);
    expect(child!.forkFromStep).toBe(3);
    expect(child!.steps.map((s) => s.seq)).toEqual([0, 1, 2, 3]); // 前缀到 3
    expect(child!.sessionId).toBe('s1');
  });

  it('拒绝从非边界（tool_call 中间态）分叉', () => {
    const run = runWithSteps(['user', 'tool_call', 'tool_result']);
    expect(forkRun(run, 1, base)).toBeNull(); // tool_call 不可切
  });

  it('拒绝越界分叉', () => {
    const run = runWithSteps(['user', 'assistant']);
    expect(forkRun(run, 99, base)).toBeNull();
  });
});

describe('buildForkContext', () => {
  it('生成截断前缀的事件摘要', () => {
    const run = runWithSteps(['user', 'assistant', 'tool_call']);
    const ctx = buildForkContext(run, 2);
    expect(ctx).toContain('[user]');
    expect(ctx).toContain('[tool_call]');
    expect(ctx.split('\n')).toHaveLength(3);
  });
});
