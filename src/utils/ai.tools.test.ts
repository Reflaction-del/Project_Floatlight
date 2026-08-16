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
    expect(t.parameters.properties.prompt).toBeDefined();
    expect(t.parameters.properties.category.enum).toContain('character');
  });

  it('app.openModule 参数 module 是 enum', () => {
    const ctx = buildToolContext({ world: {} as any });
    const t = ctx.tools.find((x) => x.name === 'app.openModule')!;
    expect(t.parameters.properties.module.enum).toEqual(['material', 'entity', 'outline', 'consistency', 'simulation', 'ttrpg']);
  });
});