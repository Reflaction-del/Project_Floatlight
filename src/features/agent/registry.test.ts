// ============================================================
// features/agent/registry.ts 集成冒烟测试
// 验证工具注册表真实执行链路（不调 LLM）：
// 工具列表、outline.get / consistency.scan / memory.snapshot 动态工具、
// aiTools base（search_entities）委托、pre/post 钩子、Trace 回调。
// ============================================================

import { describe, it, expect } from 'vitest';
import { buildToolContext, registerTool } from './registry';
import type { WorldData } from '../../store/worldStore';

const world = (over: Partial<WorldData> = {}): WorldData =>
  ({
    folders: [], docs: [], timelines: [], styles: [], materials: [], templates: [],
    entities: [
      { id: 'a', type: 'character', name: '林夜', fields: [{ label: '身份', value: '剑客' }], custom: [], tags: ['主角'], note: '来自边城', createdAt: 1, updatedAt: 2 },
    ],
    relations: [{ id: 'r1', source: 'a', target: 'ghost', type: 'kin' as const, createdAt: 1 }],
    outline: [
      { id: 'v1', title: '第一卷', kind: 'volume' as const, parentId: null, order: 0, status: 'todo' as const, createdAt: 1, updatedAt: 1 },
      { id: 'c1', title: '第一章', kind: 'chapter' as const, parentId: 'v1', order: 0, status: 'drafting' as const, createdAt: 1, updatedAt: 1 },
    ],
    drafts: [], activeDocId: '', activeTimelineId: '', clueBoard: {}, proposals: [], chats: [],
    ...over,
  }) as WorldData;

describe('buildToolContext 冒烟（真实执行）', () => {
  it('工具列表包含 base + 动态工具', () => {
    const ctx = buildToolContext({ world: world() });
    const names = ctx.tools.map((t) => t.name);
    expect(names).toContain('search_entities');
    expect(names).toContain('get_entity');
    expect(names).toContain('outline.get');
    expect(names).toContain('consistency.scan');
    expect(names).toContain('memory.snapshot');
  });

  it('enabled 子集过滤生效', () => {
    const ctx = buildToolContext({ world: world(), enabled: ['outline.get'] });
    expect(ctx.tools.map((t) => t.name)).toEqual(['outline.get']);
  });

  it('outline.get 返回缩进大纲树', async () => {
    const ctx = buildToolContext({ world: world() });
    const out = await ctx.callTool('outline.get', {});
    expect(out).toContain('第一卷');
    expect(out).toContain('第一章');
    expect(out).toContain('进行中');
  });

  it('consistency.scan 检出悬空关系（强规则）', async () => {
    const ctx = buildToolContext({ world: world() });
    const out = await ctx.callTool('consistency.scan', {});
    expect(out).toContain('指向了不存在的实体');
    expect(out).toContain('强 1'); // 悬空是强规则；另有 1 条弱（对称缺失）
  });

  it('memory.snapshot 返回实体与大纲', async () => {
    const ctx = buildToolContext({ world: world() });
    const out = await ctx.callTool('memory.snapshot', {});
    expect(out).toContain('林夜');
    expect(out).toContain('第一卷');
  });

  it('aiTools base 委托（search_entities）', async () => {
    const ctx = buildToolContext({ world: world() });
    const out = await ctx.callTool('search_entities', { query: '林夜' });
    expect(out).not.toContain('未找到');
  });

  it('Trace 回调触发 tool_call/tool_result', async () => {
    const calls: string[] = [];
    const ctx = buildToolContext({
      world: world(),
      onToolCall: (name) => calls.push('call:' + name),
      onToolResult: (name) => calls.push('result:' + name),
    });
    await ctx.callTool('outline.get', {});
    expect(calls).toContain('call:outline.get');
    expect(calls).toContain('result:outline.get');
  });

  it('pre 钩子拒绝执行并返回错误信息', async () => {
    registerTool({
      name: 'blocked.test',
      description: '测试工具',
      parameters: { type: 'object', properties: {} },
      pre: () => '（被 pre 钩子拒绝：权限不足）',
      execute: () => '不应执行',
    });
    const ctx = buildToolContext({ world: world() });
    expect(await ctx.callTool('blocked.test', {})).toContain('拒绝');
  });
});
