// ============================================================
// features/bridge/bridgeLogic.ts 单元测试
// 守护灵感整理管线纯函数：结构化 prompt / 响应容错解析 /
// 大纲节点推荐 / 直存与结构化草稿构造 / 回执组装。
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  buildStructuredPrompt,
  parseStructuredResponse,
  findOutlineHint,
  buildRawDraft,
  buildStructuredDraft,
  buildBridgeResponse,
} from './bridgeLogic';
import type { OutlineNode } from '../outline/types';

const payload = {
  platform: 'qq', chatId: 'g1', userId: 'u1', nickname: '小林',
  text: '想到一个设定：云隐城的灵脉枯竭，人们开始用星辉替代能源。', ts: 1700000000000,
};

const outline = (): OutlineNode[] => [
  { id: 'v1', title: '第一卷 灵脉危机', kind: 'volume' as const, parentId: null, order: 0, status: 'todo' as const, createdAt: 1, updatedAt: 1 },
  { id: 'c1', title: '第一章 星辉替代', kind: 'chapter' as const, parentId: 'v1', order: 0, status: 'todo' as const, createdAt: 1, updatedAt: 1 },
];

describe('buildStructuredPrompt', () => {
  it('包含灵感原文与 JSON 指令', () => {
    const p = buildStructuredPrompt('测试');
    expect(p.system).toContain('JSON');
    expect(p.user).toContain('测试');
  });
});

describe('parseStructuredResponse', () => {
  it('解析裸 JSON', () => {
    const r = parseStructuredResponse('{"title":"灵脉危机","summary":"设定摘要","tags":["地理","能源"],"entities":["云隐城"]}');
    expect(r.title).toBe('灵脉危机');
    expect(r.tags).toContain('能源');
    expect(r.entities).toContain('云隐城');
  });

  it('容忍 ```json 包裹', () => {
    const r = parseStructuredResponse('```json\n{"title":"T","summary":"S","tags":[],"entities":[]}\n```');
    expect(r.title).toBe('T');
  });

  it('解析失败降级：首行作标题', () => {
    const r = parseStructuredResponse('这不是 JSON\n第二行');
    expect(r.title).toBe('这不是 JSON');
    expect(r.summary).toContain('第二行');
  });
});

describe('findOutlineHint（大纲推荐）', () => {
  it('文本包含标题时命中', () => {
    const hint = findOutlineHint(outline(), '关于星辉替代能源的想法');
    expect(hint).not.toBeNull();
    expect(hint!.id).toBe('c1');
  });

  it('标题包含文本前缀时命中', () => {
    const hint = findOutlineHint(outline(), '灵脉危机的后续发展');
    expect(hint!.id).toBe('v1');
  });

  it('无命中返回 null，空输入安全', () => {
    expect(findOutlineHint(outline(), '完全无关的内容')).toBeNull();
    expect(findOutlineHint(outline(), '')).toBeNull();
    expect(findOutlineHint(undefined, 'x')).toBeNull();
  });
});

describe('buildRawDraft / buildStructuredDraft', () => {
  it('直存草稿带来源标记与时间戳标题', () => {
    const d = buildRawDraft(payload);
    expect(d.title).toContain('小林');
    expect(d.content).toBe(payload.text);
    expect(d.source).toEqual({ platform: 'qq', userId: 'u1', nickname: '小林', ts: payload.ts });
  });

  it('结构化草稿含摘要/概念/大纲推荐元数据', () => {
    const parsed = { title: '星辉替代', summary: '能源转型设想', tags: ['能源'], entities: ['云隐城'] };
    const d = buildStructuredDraft(payload, parsed, { id: 'c1', title: '第一章 星辉替代' });
    expect(d.title).toBe('星辉替代');
    expect(d.content).toContain('能源转型设想');
    expect(d.content).toContain('云隐城');
    expect(d.content).toContain(payload.text);
    expect(d.outlineHint).toEqual({ id: 'c1', title: '第一章 星辉替代' });
    expect(d.tags).toEqual(['能源']);
  });
});

describe('buildBridgeResponse', () => {
  it('回执含 ok/draftId/mode/summary/outlineHint', () => {
    const r = buildBridgeResponse({ ok: true, draftId: 'df-1', mode: 'structured', summary: '摘要', outlineHint: { id: 'c1', title: '章' } });
    expect(r.ok).toBe(true);
    expect(r.draftId).toBe('df-1');
    expect(r.summary).toBe('摘要');
    expect(r.outlineHint).toEqual({ id: 'c1', title: '章' });
  });

  it('失败回执含 error', () => {
    const r = buildBridgeResponse({ ok: false, mode: 'raw', error: '模型未配置' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('模型未配置');
  });
});
