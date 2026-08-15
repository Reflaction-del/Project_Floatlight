// ============================================================
// features/simulation/runtime.ts 单元测试
// 守护 SubAgent 单步执行（mock chatFn）：角色选择（导演/沙盘）、
// 上下文组装、事件分类、记忆槽更新、auto 连推与预算停止。
// ============================================================

import { describe, it, expect, vi } from 'vitest';
import { runSimulationStep, runSimulationSteps, classifyEventKind } from './runtime';
import { newSimulation } from './simOps';
import type { Simulation, SubAgent } from './types';
import type { WorldData } from '../../store/worldStore';

const actor = (id: string, strategy: SubAgent['strategy'] = 'autonomous'): SubAgent => ({
  id, entityId: '林夜', role: 'protagonist', personaPrompt: '你是一名剑客。', memorySlot: [], strategy,
});

const world = () => ({ entities: [], relations: [], outline: [], timelines: [], docs: [], folders: [], styles: [], materials: [], templates: [], drafts: [], activeDocId: '', activeTimelineId: '', clueBoard: {}, proposals: [], chats: [], simulations: [], bridgeLog: [] }) as WorldData;

const sim = (over: Partial<Simulation> = {}): Simulation =>
  newSimulation({ mode: 'sandbox', title: '测试', scenario: '雨夜', actors: [actor('a'), actor('b')], ...over });

const mockChat = (reply: string) => vi.fn(async (_model: any, _messages: any[]) => reply);
const noModel = (): any => ({ id: 'm1', label: '测试', endpoint: 'http://x', apiKey: 'k', model: 'gpt-x', format: 'chat' });

describe('classifyEventKind', () => {
  it('引号对白判为 speech，其余 action', () => {
    expect(classifyEventKind('「住手！」他喊道')).toBe('speech');
    expect(classifyEventKind('林夜拔出长剑')).toBe('action');
  });
});

describe('runSimulationStep', () => {
  it('沙盘模式自动轮换角色并追加事件', async () => {
    const s = sim();
    const r = await runSimulationStep(
      { world: world(), sim: s },
      { chatFn: mockChat('拔剑向前'), getModel: () => noModel() },
    );
    expect(r.event).not.toBeNull();
    expect(r.event!.kind).toBe('action');
    expect(r.sim.events).toHaveLength(1);
    expect(r.sim.events[0].actor).toBe('a'); // 首个自主角色
    // 记忆槽更新
    expect(r.sim.actors[0].memorySlot).toHaveLength(1);
    expect(r.sim.actors[0].memorySlot[0]).toContain('拔剑向前');
  });

  it('导演式需指定角色，指令注入上下文', async () => {
    const chatFn = mockChat('好的。');
    const s = sim({ mode: 'directed' });
    const r = await runSimulationStep(
      { world: world(), sim: s, actorId: 'b', userDirective: '说出真相' },
      { chatFn, getModel: () => noModel() },
    );
    expect(r.event).not.toBeNull();
    // 上下文包含导演指令
    const ctx = chatFn.mock.calls[0][1][1].content as string;
    expect(ctx).toContain('说出真相');
    expect(ctx).toContain('根据指令');
  });

  it('导演式无效角色返回错误', async () => {
    const s = sim({ mode: 'directed' });
    const r = await runSimulationStep(
      { world: world(), sim: s, actorId: 'ghost' },
      { chatFn: mockChat('x'), getModel: () => noModel() },
    );
    expect(r.error).toContain('指定有效角色');
    expect(r.event).toBeNull();
  });

  it('空输出不追加事件', async () => {
    const s = sim();
    const r = await runSimulationStep(
      { world: world(), sim: s },
      { chatFn: mockChat('  '), getModel: () => noModel() },
    );
    expect(r.sim.events).toHaveLength(0);
    expect(r.error).toContain('未产出');
  });

  it('时间尺度注入上下文', async () => {
    const chatFn = mockChat('行动');
    const s = sim({ timeScale: { unit: 'week', span: 2 } });
    await runSimulationStep(
      { world: world(), sim: s },
      { chatFn, getModel: () => noModel() },
    );
    expect(chatFn.mock.calls[0][1][1].content as string).toContain('2 周');
  });
});

describe('runSimulationSteps（auto 连推）', () => {
  it('连推 N 步并逐步更新 sim', async () => {
    const s = sim({ stepBudget: 10 });
    const steps: number[] = [];
    const result = await runSimulationSteps(
      { world: world(), sim: s, steps: 4 },
      { chatFn: mockChat('继续行动'), getModel: () => noModel() },
      (r) => steps.push(r.event ? r.event.step : -1),
    );
    expect(result.sim.events).toHaveLength(4);
    expect(steps).toEqual([0, 1, 2, 3]);
  });

  it('预算耗尽时停止（ended）', async () => {
    const s = sim({ stepBudget: 2 });
    const result = await runSimulationSteps(
      { world: world(), sim: s, steps: 5 },
      { chatFn: mockChat('行动'), getModel: () => noModel() },
    );
    expect(result.sim.status).toBe('ended');
    expect(result.sim.events).toHaveLength(2);
  });

  it('abort 中断连推', async () => {
    const ctrl = new AbortController();
    const s = sim({ stepBudget: 20 });
    const result = await runSimulationSteps(
      { world: world(), sim: s, steps: 10, signal: ctrl.signal },
      { chatFn: mockChat('行动'), getModel: () => noModel() },
      (r, i) => { if (i === 2) ctrl.abort(); },
    );
    expect(result.sim.events.length).toBeLessThan(10);
  });
});
