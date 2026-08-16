// ============================================================
// 聊天接入 · 灵感处理管线（Phase 3.5 渲染进程侧）
// ------------------------------------------------------------
// 监听主进程 bridge:incoming → 按整理模式（结构化/原文直存，可切换）
// 处理 → 写入草稿箱（带来源标记/大纲推荐）→ 记接入日志 → 回执。
// 结构化模式调 LLM（当前模型），失败自动降级为原文直存。
// ============================================================

import { useWorldStore } from '../../store/worldStore';
import { getCurrentModel } from '../../utils/ai';
import { chatOnce } from '../../utils/ai';
import {
  buildStructuredPrompt,
  parseStructuredResponse,
  findOutlineHint,
  buildRawDraft,
  buildStructuredDraft,
  buildBridgeResponse,
  type BridgePayload,
} from './bridgeLogic';
import type { BridgeEntry } from './types';

const LS_MODE_KEY = 'fl-bridge-mode';

/** 整理模式（设置面板可切换）：structured=AI 结构化（默认）；raw=原文直存 */
export function getBridgeMode(): 'structured' | 'raw' {
  try {
    return localStorage.getItem(LS_MODE_KEY) === 'raw' ? 'raw' : 'structured';
  } catch {
    return 'structured';
  }
}

export function setBridgeMode(mode: 'structured' | 'raw'): void {
  try { localStorage.setItem(LS_MODE_KEY, mode); } catch { /* ignore */ }
}

/** 写入草稿箱 + 接入日志 */
function persistDraft(input: {
  title: string; content: string; mode: 'structured' | 'raw';
  payload: BridgePayload; summary?: string; outlineHint?: { id: string; title: string } | null;
  ok: boolean; error?: string;
}): { draftId: string; entry: BridgeEntry } {
  const ws = useWorldStore.getState();
  const draftId = ws.addDraftEx({
    title: input.title,
    content: input.content,
    source: {
      platform: input.payload.platform,
      userId: input.payload.userId,
      nickname: input.payload.nickname,
      ts: input.payload.ts ?? Date.now(),
    },
    tags: undefined,
    outlineHint: input.outlineHint ?? undefined,
  });
  const entry: BridgeEntry = {
    id: `be-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    ts: Date.now(),
    platform: input.payload.platform,
    userId: input.payload.userId,
    nickname: input.payload.nickname,
    text: input.payload.text,
    mode: input.mode,
    draftId,
    summary: input.summary,
    outlineHint: input.outlineHint ?? undefined,
    ok: input.ok,
    error: input.error,
  };
  useWorldStore.getState().addBridgeEntry(entry);
  return { draftId, entry };
}

/** 处理一条灵感消息（结构化/直存），返回回执对象 */
export async function processInspiration(payload: BridgePayload): Promise<Record<string, unknown>> {
  const mode = getBridgeMode();
  const outline = useWorldStore.getState().worldsData[useWorldStore.getState().current]?.outline ?? [];

  if (mode === 'raw') {
    const draft = buildRawDraft(payload);
    const { draftId } = persistDraft({ ...draft, mode: 'raw', payload, ok: true });
    return buildBridgeResponse({ ok: true, draftId, mode: 'raw' });
  }

  // 结构化：调 LLM 抽标题/摘要/标签/概念 + 大纲推荐；失败降级直存
  try {
    const model = getCurrentModel();
    if (!model) throw new Error('未配置 AI 模型（设置 → 大模型接入）');
    const { system, user } = buildStructuredPrompt(payload.text);
    const raw = await chatOnce(model, [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ], { feature: 'chat' });
    const parsed = parseStructuredResponse(raw);
    const outlineHint = findOutlineHint(outline, payload.text);
    const draft = buildStructuredDraft(payload, parsed, outlineHint);
    const { draftId, entry } = persistDraft({ ...draft, mode: 'structured', payload, summary: parsed.summary, outlineHint, ok: true });
    return buildBridgeResponse({ ok: true, draftId, mode: 'structured', summary: parsed.summary, outlineHint });
  } catch (e: any) {
    // 降级：原文直存并记录失败原因
    const draft = buildRawDraft(payload);
    const { draftId } = persistDraft({ ...draft, mode: 'raw', payload, ok: false, error: String(e?.message ?? e) });
    return buildBridgeResponse({ ok: false, draftId, mode: 'raw', error: String(e?.message ?? e) });
  }
}

/** 注册桥接监听（App 启动时调用一次）：主进程转发 → 处理 → 回执 */
export function initBridgeHandler(): void {
  const api = (window as any).api;
  if (!api || typeof api.onBridgeIncoming !== 'function') return; // 浏览器环境无 IPC
  api.onBridgeIncoming(async ({ requestId, payload }: { requestId: string; payload: BridgePayload }) => {
    try {
      const result = await processInspiration(payload);
      api.bridgeRespond(requestId, result);
    } catch (e: any) {
      api.bridgeRespond(requestId, { ok: false, error: String(e?.message ?? e) });
    }
  });
}
