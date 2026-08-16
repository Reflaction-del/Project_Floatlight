// ============================================================
// 三级记忆调度（Phase 1 认知基础）
// ------------------------------------------------------------
// 会话级（最近对话）/ 工作级（当前事件流）/ 长期级（embedding 检索）
// 三级记忆按预算组装：优先级 会话 > 工作 > 长期，超预算从长期级
// 逐块丢弃。纯函数，供 Planner / 子代理 / AI 侧栏组装上下文用。
// ============================================================

import { estimateTokens } from '../../utils/worldContext';

export interface MemorySources {
  /** 会话级：最近对话消息文本（已截断），优先级最高 */
  session: string[];
  /** 工作级：当前沙盘/跑团事件流摘要块 */
  workspace: string[];
  /** 长期级：embedding 检索结果块，优先级最低 */
  longTerm: string[];
}

export interface MemoryComposeResult {
  text: string;
  totalTokens: number;
  /** 因预算被丢弃的块标签（longTerm 先丢） */
  dropped: string[];
}

/**
 * 按预算组装三级记忆。
 * 丢弃顺序：先丢长期级（按顺序丢，直到满足预算），再丢工作级；
 * 会话级永不丢弃（对话连续性优先）。
 */
export function composeMemory(sources: MemorySources, budget: number): MemoryComposeResult {
  const dropped: string[] = [];

  // 会话级必保
  const sessionText = joinBlocks(sources.session ?? []);
  const sessionTokens = estimateTokens(sessionText);
  if (sessionTokens > budget) {
    // 极端情况：会话本身超预算，按最近优先截断（保留最后一段）
    dropped.push(...sources.session.slice(0, Math.max(0, sources.session.length - 1)));
    const keep = sources.session.slice(-1);
    return {
      text: keep.join('\n'),
      totalTokens: estimateTokens(keep.join('\n')),
      dropped,
    };
  }

  const workspaceBlocks = [...(sources.workspace ?? [])];
  const longBlocks = [...(sources.longTerm ?? [])];
  let total = sessionTokens;

  // 先放工作级（可被长期级挤出）
  const keptWorkspace: string[] = [];
  for (const block of workspaceBlocks) {
    const t = estimateTokens(block);
    if (total + t > budget) {
      dropped.push(block.slice(0, 40) + '…');
      continue;
    }
    keptWorkspace.push(block);
    total += t;
  }

  // 长期级：剩余预算内尽量放
  const keptLong: string[] = [];
  for (const block of longBlocks) {
    const t = estimateTokens(block);
    if (total + t > budget) {
      dropped.push(block.slice(0, 40) + '…');
      continue;
    }
    keptLong.push(block);
    total += t;
  }

  return {
    text: [sessionText, ...keptWorkspace, ...keptLong].filter(Boolean).join('\n\n'),
    totalTokens: total,
    dropped,
  };
}

function joinBlocks(blocks: string[]): string {
  return blocks.filter((b) => b && b.trim()).join('\n');
}
