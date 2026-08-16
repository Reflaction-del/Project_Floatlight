// ============================================================
// utils/ai.ts 纯函数单元测试
// 覆盖 AI 响应解析链的关键回归面：
//  - contentText / splitThinking：思考块分离（推理模型）
//  - extractContent / parseMessageFromBody：SSE 与单条 JSON 兜底、reasoning_content 兜底
//  - safeParseArgs：截断 JSON 宽松解析
//  - validateModelName：模型名校验
// 注意：ai.ts 与 aiStreamWorker.ts 存在双份解析实现（改一处必须同步），
// 此处测试守护 ai.ts 一侧，防止双份漂移。
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  contentText,
  splitThinking,
  extractContent,
  parseMessageFromBody,
  safeParseArgs,
  validateModelName,
} from './ai';

describe('contentText', () => {
  it('字符串原样返回', () => {
    expect(contentText('你好')).toBe('你好');
  });

  it('多段 content part 仅拼接 text 类型', () => {
    const parts: any[] = [
      { type: 'text', text: '第一段' },
      { type: 'image_url', image_url: { url: 'data:...' } },
      { type: 'text', text: '第二段' },
    ];
    expect(contentText(parts)).toBe('第一段\n第二段');
  });

  it('空输入返回空串', () => {
    expect(contentText([])).toBe('');
    expect(contentText('')).toBe('');
  });
});

describe('splitThinking（推理/思考块分离）', () => {
  it('完整 think 块被抽出，正文保留', () => {
    const { thinking, rest } = splitThinking('<think>先思考一下</think>这是最终回答');
    expect(thinking).toBe('先思考一下');
    expect(rest).toBe('这是最终回答');
  });

  it('兼容 thinking 标签（不区分大小写）', () => {
    const { thinking } = splitThinking('<Thinking>大写标签</Thinking>正文');
    expect(thinking).toBe('大写标签');
  });

  it('多个 think 块合并', () => {
    const { thinking } = splitThinking('<think>第一</think>正文<think>第二</think>');
    expect(thinking).toContain('第一');
    expect(thinking).toContain('第二');
  });

  it('流式未闭合 think：从标签到末尾视为思考', () => {
    const { thinking, rest } = splitThinking('已输出的正文 <think>还在推理中');
    expect(rest).toBe('已输出的正文');
    expect(thinking).toBe('还在推理中');
  });

  it('无 think 标签：原样返回', () => {
    const { thinking, rest } = splitThinking('普通回复');
    expect(thinking).toBe('');
    expect(rest).toBe('普通回复');
  });
});

describe('extractContent（SSE / JSON 兜底 + reasoning 解析）', () => {
  it('单条 JSON：取 message.content', () => {
    const raw = JSON.stringify({ choices: [{ message: { content: '答案' } }], usage: { total_tokens: 10 } });
    const r = extractContent(raw);
    expect(r.content).toBe('答案');
    expect(r.usage.total_tokens).toBe(10);
  });

  it('推理模型：正文在 reasoning_content 时兜底', () => {
    const raw = JSON.stringify({ choices: [{ message: { reasoning_content: '思考过程', content: '' } }] });
    expect(extractContent(raw).content).toBe('思考过程');
  });

  it('推理模型：content 为空串时仍回退 reasoning_content（回归：?? 对空串不生效）', () => {
    const raw = JSON.stringify({ choices: [{ message: { content: '', reasoning_content: '思考过程' } }] });
    expect(extractContent(raw).content).toBe('思考过程');
  });

  it('推理模型：正文在 reasoning 字段时兜底', () => {
    const raw = JSON.stringify({ choices: [{ message: { reasoning: '思考', content: '' } }] });
    expect(extractContent(raw).content).toBe('思考');
  });

  it('SSE 流：逐行拼接 delta，reasoning_content 兜底', () => {
    const lines = [
      'data: {"choices":[{"delta":{"reasoning_content":"推理"}}]}',
      'data: {"choices":[{"delta":{"content":"正文"}}]}',
      'data: [DONE]',
    ].join('\n');
    expect(extractContent(lines).content).toBe('推理正文');
  });

  it('SSE 流：兼容 choices[0].text 增量', () => {
    const lines = ['data: {"choices":[{"text":"增量一"}]}', 'data: {"choices":[{"text":"增量二"}]}'].join('\n');
    expect(extractContent(lines).content).toBe('增量一增量二');
  });

  it('非 JSON 文本：原样返回 content', () => {
    const r = extractContent('纯文本回复');
    expect(r.content).toBe('纯文本回复');
    expect(r.usage).toBeNull();
  });

  it('空输入返回空 content', () => {
    expect(extractContent('').content).toBe('');
  });
});

describe('parseMessageFromBody（assistant 消息抽取，含 tool_calls）', () => {
  it('单条 JSON：content + tool_calls', () => {
    const raw = JSON.stringify({
      choices: [{ message: { role: 'assistant', content: '好的', tool_calls: [{ id: 't1', type: 'function', function: { name: 'f', arguments: '{}' } }] } }],
    });
    const m = parseMessageFromBody(raw);
    expect(m.content).toBe('好的');
    expect(m.tool_calls?.[0].function.name).toBe('f');
  });

  it('推理模型：reasoning_content 兜底为 content', () => {
    const raw = JSON.stringify({ choices: [{ message: { reasoning_content: '思考' } }] });
    expect(parseMessageFromBody(raw).content).toBe('思考');
  });

  it('SSE：tool_calls 按 index 累加参数片段', () => {
    const lines = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"t1","function":{"name":"look","arguments":"{\\"q\\""}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":":\\"xx\\"}"}}]}}]}',
      'data: [DONE]',
    ].join('\n');
    const m = parseMessageFromBody(lines);
    expect(m.tool_calls?.[0].function.name).toBe('look');
    expect(m.tool_calls?.[0].function.arguments).toBe('{"q":"xx"}');
  });

  it('SSE：content 与 reasoning_content 增量拼接', () => {
    const lines = [
      'data: {"choices":[{"delta":{"reasoning_content":"思考"}}]}',
      'data: {"choices":[{"delta":{"content":"正文"}}]}',
    ].join('\n');
    expect(parseMessageFromBody(lines).content).toBe('思考正文');
  });

  it('非法文本：原样作为 content 返回', () => {
    expect(parseMessageFromBody('abc').content).toBe('abc');
  });
});

describe('safeParseArgs（截断 JSON 宽松解析）', () => {
  it('合法 JSON 正常解析', () => {
    expect(safeParseArgs('{"a":1}')).toEqual({ a: 1 });
  });

  it('空输入返回空对象', () => {
    expect(safeParseArgs('')).toEqual({});
    expect(safeParseArgs('   ')).toEqual({});
  });

  it('缺右括号自动补齐', () => {
    expect(safeParseArgs('{"a":1, "b":2')).toEqual({ a: 1, b: 2 });
  });

  it('无法修复的输入返回空对象', () => {
    expect(safeParseArgs('not json at all')).toEqual({});
  });
});

describe('validateModelName', () => {
  it('合法模型名通过', () => {
    expect(validateModelName('gpt-4o-mini')).toBeNull();
    expect(validateModelName('qwen2.5-7b-instruct')).toBeNull();
  });

  it('空模型名报错', () => {
    expect(validateModelName('')).not.toBeNull();
    expect(validateModelName('   ')).not.toBeNull();
  });
});
