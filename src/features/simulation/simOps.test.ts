// ============================================================
// features/simulation/simOps.ts 单元测试
// 守护模拟纯函数：创建 / 事件追加（步数+预算）/ 沙盘轮换 /
// 记忆槽裁剪 / 角色上下文拼装。
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  newSimulation,
  pushEvent,
  nextActor,
  appendMemory,
  recentEvents,
  buildActorContext,
  MEMORY_SLOT_MAX,
  DEFAULT_STEP_BUDGET,
} from './simOps';
import type { Simulation, SubAgent } from './types';

const actor = (id: string, name: string, strategy: SubAgent['strategy'] = 'autonomous', modelId?: string): SubAgent => ({
  id, entityId: 'e-' + id, role: 'protagonist', personaPrompt: `你是${name}，一名剑客。`, memorySlot: [], strategy, modelId,
});

const baseSim = (over: Partial<Simulation> = {}): Simulation =>
  newSimulation({
    mode: 'sandbox', title: '测试模拟', scenario: '雨夜，城门口。',
    actors: [actor('a', '林夜'), actor('b', '苏泠', 'on-command')],
    ...over,
  });

describe('newSimulation', () => {
  it('创建模拟并带默认值', () => {
    const s = baseSim();
    expect(s.status).toBe('running');
    expect(s.pacing).toBe('step');
    expect(s.stepBudget).toBe(DEFAULT_STEP_BUDGET);
    expect(s.events).toHaveLength(0);
    expect(s.actors).toHaveLength(2);
  });

  it('时间尺度透传', () => {
    const s = baseSim({ timeScale: { unit: 'week', span: 2 } });
    expect(s.timeScale).toEqual({ unit: 'week', span: 2 });
  });
});

describe('pushEvent', () => {
  it('step 从 0 递增', () => {
    let s = baseSim();
    s = pushEvent(s, { actor: 'a', kind: 'action', content: '拔剑' });
    s = pushEvent(s, { actor: 'b', kind: 'speech', content: '住手' });
    expect(s.events.map((e) => e.step)).toEqual([0, 1]);
    expect(s.events[0].kind).toBe('action');
  });

  it('到达 stepBudget 时自动结束', () => {
    let s = baseSim({ stepBudget: 3 });
    s = pushEvent(s, { actor: 'a', kind: 'action', content: 'x' });
    s = pushEvent(s, { actor: 'a', kind: 'action', content: 'y' });
    s = pushEvent(s, { actor: 'a', kind: 'action', content: 'z' }); // 第 3 步触发结束
    expect(s.status).toBe('ended');
  });
});

describe('nextActor（沙盘轮换）', () => {
  it('跳过 on-command 角色，自主角色轮流', () => {
    const s = baseSim(); // a=autonomous, b=on-command
    expect(nextActor(s)?.id).toBe('a');
    const s2 = pushEvent(s, { actor: 'a', kind: 'action', content: '行动' });
    expect(nextActor(s2)?.id).toBe('a'); // 仅 a 自主 → 始终 a
  });

  it('导演式返回 null（由用户指定角色）', () => {
    const s = baseSim({ mode: 'directed' });
    expect(nextActor(s)).toBeNull();
  });

  it('无自主角色返回 null', () => {
    const s = baseSim({ actors: [actor('a', '林夜', 'on-command')] });
    expect(nextActor(s)).toBeNull();
  });
});

describe('appendMemory（记忆槽）', () => {
  it('追加并保留最近 MEMORY_SLOT_MAX 条', () => {
    let a = actor('a', '林夜');
    for (let i = 0; i < MEMORY_SLOT_MAX + 5; i++) a = appendMemory(a, `经历${i}`);
    expect(a.memorySlot).toHaveLength(MEMORY_SLOT_MAX);
    expect(a.memorySlot[0]).toBe('经历5'); // 最早 5 条被丢弃（15-10=5）
    expect(a.memorySlot.at(-1)).toBe('经历14');
  });
});

describe('recentEvents', () => {
  it('取最近 N 条', () => {
    let s = baseSim();
    for (let i = 0; i < 10; i++) s = pushEvent(s, { actor: 'a', kind: 'action', content: `e${i}` });
    expect(recentEvents(s, 3).map((e) => e.content)).toEqual(['e7', 'e8', 'e9']);
  });
});

describe('buildActorContext', () => {
  it('拼接身份/人格/记忆/最近事件/指令', () => {
    const ctx = buildActorContext({
      actorName: '林夜',
      personaPrompt: '你是林夜。',
      memorySlot: ['昨晚见过苏泠'],
      recent: [{ id: '1', ts: 0, step: 0, actor: '林夜', kind: 'action', content: '拔剑' }],
      worldSnapshot: '【实体】林夜：剑客',
      timeScaleText: '2 周',
      userDirective: '说出你的真实想法',
      directed: true,
    });
    expect(ctx).toContain('林夜');
    expect(ctx).toContain('【人格与目标】');
    expect(ctx).toContain('昨晚见过苏泠');
    expect(ctx).toContain('【导演指令】说出你的真实想法');
    expect(ctx).toContain('第一人称');
  });

  it('导演式与自主式指令文案不同', () => {
    const directed = buildActorContext({ actorName: 'a', personaPrompt: '', memorySlot: [], recent: [], worldSnapshot: '', timeScaleText: '', userDirective: '说', directed: true });
    const auto = buildActorContext({ actorName: 'a', personaPrompt: '', memorySlot: [], recent: [], worldSnapshot: '', timeScaleText: '', directed: false });
    expect(directed).toContain('根据指令');
    expect(auto).toContain('自主决定');
  });
});
