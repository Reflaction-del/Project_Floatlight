import { describe, it, expect } from 'vitest';
import { serializeWorldTemplate, deserializeWorldTemplate, summarizeTemplate, worldTemplateFilename } from './worldTemplate';

const minimalWorld: any = {
  entities: [{ id: 'e1', type: 'character', name: '林夜' }],
  relations: [{ id: 'r1', source: 'e1', target: 'e2', type: 'kin' }],
  timelines: [{ id: 't1', name: '主线', events: [] }],
  outline: [{ id: 'o1', title: '第一卷', kind: 'volume', parentId: null, order: 0, status: 'todo' }],
  docs: [{ id: 'd1', title: '第一章', content: '<p>正文</p>' }],
  folders: ['设定'],
  styles: [{ id: 's1', name: '暗金' }],
  templates: [{ id: 'tp1', name: '角色卡' }],
  materials: [],
  rulebooks: [{ id: 'rb1', name: '自定义' }],
  drafts: [{ id: 'x', title: 't', content: 'c' }],
  ttrpgSessions: [{ id: 'tt1' }],
  bridgeLog: [],
  proposals: [],
  chats: [],
  simulations: [],
  activeDocId: 'd1',
};

describe('serializeWorldTemplate 序列化', () => {
  it('只打包核心字段，排除运行时数据', () => {
    const text = serializeWorldTemplate(minimalWorld, { name: '测试世界', description: 'demo' });
    const parsed = JSON.parse(text);
    expect(parsed.format).toBe('fugu-world');
    expect(parsed.version).toBe(1);
    expect(parsed.name).toBe('测试世界');
    expect(parsed.world.entities).toHaveLength(1);
    expect(parsed.world.rulebooks).toHaveLength(1);
    expect(parsed.world.drafts).toBeUndefined();
    expect(parsed.world.ttrpgSessions).toBeUndefined();
    expect(parsed.world.bridgeLog).toBeUndefined();
    expect(parsed.world.activeDocId).toBeUndefined();
  });

  it('includeDocs=false 排除文档', () => {
    const text = serializeWorldTemplate(minimalWorld, { includeDocs: false });
    expect(JSON.parse(text).world.docs).toBeUndefined();
  });
});

describe('deserializeWorldTemplate 解析', () => {
  it('合法模板通过', () => {
    const text = serializeWorldTemplate(minimalWorld, { name: '回环' });
    const { template, error } = deserializeWorldTemplate(text);
    expect(error).toBeUndefined();
    expect(template?.name).toBe('回环');
    expect(template?.world.entities).toHaveLength(1);
  });

  it('非法输入返回 error 不抛异常', () => {
    expect(deserializeWorldTemplate('').error).toContain('空');
    expect(deserializeWorldTemplate('not json').error).toContain('JSON');
    expect(deserializeWorldTemplate('{"format":"other"}').error).toContain('fugu-world');
    expect(deserializeWorldTemplate('{"format":"fugu-world","version":99,"world":{}}').error).toContain('版本');
    expect(deserializeWorldTemplate('{"format":"fugu-world","version":1}').error).toContain('world');
  });
});

describe('summarizeTemplate 内容统计', () => {
  it('统计各类型数量', () => {
    const t = serializeWorldTemplate(minimalWorld, { name: 'x' });
    const { template } = deserializeWorldTemplate(t);
    const sum = summarizeTemplate(template!);
    expect(sum).toContain('实体 1');
    expect(sum).toContain('规则书 1');
    expect(sum).toContain('文档 1');
  });
});

describe('worldTemplateFilename 文件名', () => {
  it('非法字符清洗', () => {
    expect(worldTemplateFilename('我的/世界:*?')).toBe('我的_世界___.fuguworld');
    expect(worldTemplateFilename('')).toBe('世界模板.fuguworld');
  });
});
