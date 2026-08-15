// ============================================================
// features/materials/bindings.ts 单元测试
// 守护 MaterialForge 八源字段绑定解析（纯函数）：
// resolveBinding（entity/customField/field/world/style/image/static/ai）
// interpolate 插值、resolveShowIf 条件渲染、applyTone 语气词典。
// ============================================================

import { describe, it, expect } from 'vitest';
import { resolveBinding, interpolate, resolveShowIf, applyTone } from './bindings';
import type { RenderContext } from './bindings';
import type { StyleToken } from './types';
import type { WikiEntity } from '../../types';

const token = {
  palette: { accent: '#123456', bg: '#ffffff' },
  logo: { src: 'logo.png' },
  tone: { dictionary: [{ from: '喵', to: '嗷' }] },
} as unknown as StyleToken;

const entity: WikiEntity = {
  id: 'e1', type: 'character', name: '林夜', fields: [{ label: '身份', value: '剑客' }],
  custom: [{ label: '种族', value: '人族' }], tags: [], createdAt: 1, updatedAt: 1,
  materialFields: { 年龄: '27', 武器: '长剑' },
  portrait: { mode: 'entity' as const },
};

const baseCtx = (over: Partial<RenderContext> = {}): RenderContext => ({
  entity, worldName: '测试世界', token, portraitMode: 'entity', useAI: false, allEntities: [entity], ...over,
});

describe('resolveBinding', () => {
  it('entity 直接字段与结构化字段 label 回退', () => {
    expect(resolveBinding({ source: 'entity', path: 'name' }, baseCtx())).toBe('林夜');
    expect(resolveBinding({ source: 'entity', path: '身份' }, baseCtx())).toBe('剑客'); // label 回退
    expect(resolveBinding({ source: 'entity', path: '不存在', fallback: '兜底' }, baseCtx())).toBe('兜底');
  });

  it('customField/field 按 materialFields 读取，custom 回退', () => {
    expect(resolveBinding({ source: 'customField', path: '年龄' }, baseCtx())).toBe('27');
    expect(resolveBinding({ source: 'field', path: '武器' }, baseCtx())).toBe('长剑');
    expect(resolveBinding({ source: 'customField', path: '种族' }, baseCtx())).toBe('人族'); // custom 回退
    expect(resolveBinding({ source: 'customField', path: '不存在' }, baseCtx())).toBe('');
    expect(resolveBinding({ source: 'customField', path: '*' }, baseCtx())).toBe(''); // 通配仅 showIf 用
  });

  it('world/style/static/ai 来源', () => {
    expect(resolveBinding({ source: 'world', path: 'worldName' }, baseCtx())).toBe('测试世界');
    expect(resolveBinding({ source: 'style', path: 'accent' }, baseCtx())).toBe('#123456');
    expect(resolveBinding({ source: 'static', path: '', static: '固定文本' }, baseCtx())).toBe('固定文本');
    expect(resolveBinding({ source: 'ai', path: '武器' }, baseCtx())).toBe('长剑'); // aiValues 缺 → materialFields
    expect(resolveBinding({ source: 'ai', path: '武器', fallback: '无' }, baseCtx({ aiValues: { 武器: 'AI值' } }))).toBe('AI值'); // aiValues 优先
  });

  it('entity 为空时全部回退 fallback', () => {
    const ctx = baseCtx({ entity: null });
    expect(resolveBinding({ source: 'entity', path: 'name', fallback: '无名' }, ctx)).toBe('无名');
    expect(resolveBinding({ source: 'customField', path: '年龄', fallback: '?' }, ctx)).toBe('?');
  });
});

describe('interpolate', () => {
  it('{entity:name} / {customField:key} / {world:xxx} 插值', () => {
    expect(interpolate('我是{entity:name}，{customField:年龄}岁', baseCtx())).toBe('我是林夜，27岁');
    expect(interpolate('来自{world:worldName}', baseCtx())).toBe('来自测试世界');
  });

  it('未命中绑定替换为空串（不残留占位符）', () => {
    expect(interpolate('占位[{entity:不存在}]', baseCtx())).toBe('占位[]');
  });
});

describe('resolveShowIf', () => {
  it('notEmpty 条件', () => {
    expect(resolveShowIf({ source: 'customField', path: '年龄', notEmpty: true }, baseCtx())).toBe(true);
    expect(resolveShowIf({ source: 'customField', path: '不存在', notEmpty: true }, baseCtx())).toBe(false);
  });

  it('equals 条件', () => {
    expect(resolveShowIf({ source: 'entity', path: 'name', equals: '林夜' }, baseCtx())).toBe(true);
    expect(resolveShowIf({ source: 'entity', path: 'name', equals: '王五' }, baseCtx())).toBe(false);
  });

  it('customField 通配：有任意字段即显示', () => {
    expect(resolveShowIf({ source: 'customField', path: '*', notEmpty: true }, baseCtx())).toBe(true);
    const empty = baseCtx({ entity: { ...entity, materialFields: {}, custom: [] } });
    expect(resolveShowIf({ source: 'customField', path: '*', notEmpty: true }, empty)).toBe(false);
  });
});

describe('applyTone', () => {
  it('词典替换生效，无命中保持原样', () => {
    expect(applyTone('喵喵叫', token)).toBe('嗷嗷叫');
    expect(applyTone('普通文本', token)).toBe('普通文本');
  });
});
