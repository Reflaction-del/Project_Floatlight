// ============================================================
// 聊天接入 · 桥接逻辑纯函数（Phase 3.5）
// ------------------------------------------------------------
// 灵感消息处理管线（不依赖运行时的可测部分）：
// 结构化 prompt 构造 / 响应解析（容错 JSON）/ 大纲节点推荐匹配 /
// 直存与结构化草稿构造。
// ============================================================

import type { OutlineNode } from '../outline/types';
import type { DraftSource } from './types';

export interface BridgePayload {
  platform: string;
  chatId: string;
  userId: string;
  nickname: string;
  text: string;
  ts?: number;
}

export interface StructuredResult {
  title: string;
  summary: string;
  tags: string[];
  entities: string[];
}

export interface DraftInput {
  title: string;
  content: string;
  source?: DraftSource;
  tags?: string[];
  outlineHint?: { id: string; title: string } | null;
}

/** 结构化整理的系统提示 + 用户消息 */
export function buildStructuredPrompt(text: string): { system: string; user: string } {
  return {
    system:
      '你是浮光世界观编辑器的灵感整理助手。把用户发来的灵感消息整理为结构化草稿，仅输出一个 JSON（不要多余文字）：' +
      '{"title":"简短标题","summary":"一句话摘要","tags":["标签"],"entities":["提及的已有/新概念"]}',
    user: `灵感消息：\n${text}`,
  };
}

/** 容错解析结构化响应（容忍 ```json 包裹与前后杂质） */
export function parseStructuredResponse(raw: string): StructuredResult {
  const text = (raw || '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const objMatch = candidate.match(/\{[\s\S]*\}/);
  try {
    const obj = JSON.parse(objMatch ? objMatch[0] : candidate);
    return {
      title: typeof obj.title === 'string' ? obj.title.slice(0, 80) : '灵感',
      summary: typeof obj.summary === 'string' ? obj.summary.slice(0, 200) : '',
      tags: Array.isArray(obj.tags) ? obj.tags.map(String).slice(0, 8) : [],
      entities: Array.isArray(obj.entities) ? obj.entities.map(String).slice(0, 8) : [],
    };
  } catch {
    // 降级：首行作标题，全文作摘要
    const firstLine = text.split('\n')[0].slice(0, 80);
    return { title: firstLine || '灵感', summary: text.slice(0, 200), tags: [], entities: [] };
  }
}

/** 去掉标题结构前缀（第X卷/章/节/篇）与标点，返回可匹配关键词 */
function stripTitleStructural(title: string): string {
  return title
    .replace(/^第[一二三四五六七八九十百千]+[卷章节篇部幕]/, '')
    .replace(/[·\s，。、：:「」『』]/g, '')
    .trim();
}

/**
 * 大纲节点推荐：文本与大纲节点标题匹配。
 * 1) 文本完整包含标题 → 命中；2) 标题去掉结构词后，关键词被文本包含 → 命中。
 * 无命中返回 null。
 */
export function findOutlineHint(outline: OutlineNode[] | undefined, text: string): { id: string; title: string } | null {
  if (!outline || outline.length === 0 || !text) return null;
  const t = text.trim();
  if (!t) return null;
  const exact = outline.find((n) => n.title && n.title.length >= 2 && t.includes(n.title));
  if (exact) return { id: exact.id, title: exact.title };
  for (const n of outline) {
    if (!n.title) continue;
    const kw = stripTitleStructural(n.title);
    if (kw.length >= 2 && t.includes(kw)) return { id: n.id, title: n.title };
  }
  return null;
}

/** 原文直存草稿（标题=来源昵称 + 时间戳短标签） */
export function buildRawDraft(payload: BridgePayload): DraftInput {
  const ts = new Date(payload.ts ?? Date.now());
  const stamp = `${ts.getMonth() + 1}月${ts.getDate()}日 ${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}`;
  return {
    title: `${payload.nickname || payload.platform} 的灵感 · ${stamp}`,
    content: payload.text,
    source: {
      platform: payload.platform,
      userId: payload.userId,
      nickname: payload.nickname,
      ts: payload.ts ?? Date.now(),
    },
  };
}

/** 结构化草稿（摘要/标签/大纲推荐作为元数据，正文保留原文） */
export function buildStructuredDraft(payload: BridgePayload, parsed: StructuredResult, outlineHint: { id: string; title: string } | null): DraftInput {
  const body = [
    parsed.summary ? `> 摘要：${parsed.summary}\n` : '',
    parsed.entities.length ? `> 相关概念：${parsed.entities.join('、')}\n` : '',
    '\n' + payload.text,
  ].join('');
  return {
    title: parsed.title || '灵感',
    content: body,
    source: {
      platform: payload.platform,
      userId: payload.userId,
      nickname: payload.nickname,
      ts: payload.ts ?? Date.now(),
    },
    tags: parsed.tags,
    outlineHint,
  };
}

/** 回执组装（供主进程 HTTP 响应） */
export function buildBridgeResponse(result: {
  ok: boolean;
  draftId?: string;
  mode: 'structured' | 'raw';
  summary?: string;
  outlineHint?: { id: string; title: string } | null;
  error?: string;
}): Record<string, unknown> {
  return {
    ok: result.ok,
    draftId: result.draftId,
    mode: result.mode,
    summary: result.summary,
    outlineHint: result.outlineHint ?? undefined,
    error: result.error,
  };
}
