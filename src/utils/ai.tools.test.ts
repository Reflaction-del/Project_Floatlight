import { describe, it, expect } from 'vitest';
import { buildToolContext } from '../features/agent/registry';

describe('P5 工具能力 buildToolsPayload', () => {
  it('buildToolContext 返回的工具包含 app.openModule / material.create', () => {
    // 给个最小世界数据，dynamicTools 闭包只需基础字段
    const ctx = buildToolContext({
      world: {
        entities: [],
        relations: [],
        outline: [],
        timelines: [],
        docs: [],
        folders: [],
        // 其他字段 dynamicTools 不读，可省略
      } as any,
    });
    const names = ctx.tools.map((t) => t.name);
    expect(names).toContain('app.openModule');
    expect(names).toContain('material.create');
    expect(names).toContain('outline.get');
    expect(names).toContain('consistency.scan');
    expect(names).toContain('memory.snapshot');
  });

  it('工具 schema 是 OpenAI function calling 格式', () => {
    const ctx = buildToolContext({ world: {} as any });
    const t = ctx.tools.find((x) => x.name === 'material.create')!;
    expect(t).toBeDefined();
    expect(t.parameters.type).toBe('object');
    expect((t.parameters as any).properties.prompt).toBeDefined();
    expect((t.parameters as any).properties.category.enum).toContain('character');
  });

  it('app.openModule 参数 module 是 enum', () => {
    const ctx = buildToolContext({ world: {} as any });
    const t = ctx.tools.find((x) => x.name === 'app.openModule')!;
    expect((t.parameters as any).properties.module.enum).toEqual(['material', 'entity', 'outline', 'consistency', 'simulation', 'ttrpg']);
  });

  it('物料配置三工具已注册（listTemplates/listStyles/configure）', async () => {
    const ctx = buildToolContext({ world: { templates: [{ id: 't1', name: '测试卡', category: 'personnel', blocks: [{ type: 'text', content: '{field:name}' }, { type: 'text', content: '{customField:ai_bio}' }] }] } as any });
    const names = ctx.tools.map((t) => t.name);
    expect(names).toContain('material.listTemplates');
    expect(names).toContain('material.listStyles');
    expect(names).toContain('material.configure');
    // configure 参数结构
    const cfg = ctx.tools.find((x) => x.name === 'material.configure')!;
    expect((cfg.parameters as any).properties.fields.type).toBe('object');
    // listTemplates 可列出模板字段（执行走 ctx.callTool）
    const text = await ctx.callTool('material.listTemplates', {});
    expect(text).toContain('t1');
    expect(text).toContain('name');
    expect(text).toContain('ai_bio');
  });
});