// ============================================================
// 世界快照打包器（Phase 1 认知基础）
// ------------------------------------------------------------
// 把世界状态压缩为「Agent 可读的上下文文本」：实体（topK 按 impact）、
// 关系、大纲树、时间线、文档标题。供 Planner / 子代理初始化 / 沙盘
// 推演使用。纯函数，便于单测与多入口复用。
// 预算裁减：超预算时按 文档→时间线→大纲→关系→实体 优先级反向丢弃
//（实体与大纲是硬设定，最后才丢）。
// ============================================================

import type { WorldData } from '../../store/worldStore';
import type { WikiEntity } from '../../types';
import { treeify } from '../outline/outlineOps';
import { OUTLINE_KIND_LABEL, OUTLINE_STATUS_LABEL } from '../outline/types';
import { estimateTokens } from '../../utils/worldContext';
import { ENTITY_LABEL, RELATION_LABEL } from '../../types';

export interface WorldSnapshotOptions {
  /** 实体取前 K（按最近更新降序），默认 30 */
  entityTopK?: number;
  /** 总 token 预算，默认 4000 */
  tokenBudget?: number;
  /** 是否含时间线事件，默认 true */
  includeTimeline?: boolean;
  /** 是否含文档（仅标题列表），默认 true */
  includeDocs?: boolean;
  /** 关系条数上限，默认 80 */
  maxRelations?: number;
  /** 每条时间线事件上限，默认 40 */
  maxTimelineEvents?: number;
}

export interface WorldSnapshotResult {
  text: string;
  totalTokens: number;
  /** 是否发生裁减（预算超限后丢弃了低优先级段） */
  truncated: boolean;
  stats: {
    entities: number;
    relations: number;
    outlineNodes: number;
    timelineEvents: number;
    docs: number;
  };
}

type Section = { key: string; text: string; priority: number };

export function buildWorldSnapshot(
  world: Pick<WorldData, 'entities' | 'relations' | 'outline' | 'timelines' | 'docs'>,
  opts: WorldSnapshotOptions = {},
): WorldSnapshotResult {
  const {
    entityTopK = 30,
    tokenBudget = 4000,
    includeTimeline = true,
    includeDocs = true,
    maxRelations = 80,
    maxTimelineEvents = 40,
  } = opts;

  const entities = [...(world.entities ?? [])]
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)) // 最近活跃优先
    .slice(0, entityTopK);
  const byId = new Map(entities.map((e) => [e.id, e]));

  // —— 各段文本（priority 大者优先保留） ——
  const sections: Section[] = [];

  // 1. 实体（最高优先级）
  const entityLines = entities.map((e) => `- ${e.name}（${ENTITY_LABEL[e.type] ?? e.type}）${e.note ? '：' + e.note : ''}`);
  sections.push({ key: 'entities', text: entityLines.length ? `【实体】\n${entityLines.join('\n')}` : '', priority: 5 });

  // 2. 关系
  const relations = (world.relations ?? []).slice(0, maxRelations);
  const relLines = relations
    .map((r) => {
      const s = byId.get(r.source)?.name ?? r.source;
      const t = byId.get(r.target)?.name ?? r.target;
      return `- ${s} → ${t}（${RELATION_LABEL[r.type] ?? r.type}）`;
    })
    .filter((l) => !l.includes('→ undefined'));
  sections.push({ key: 'relations', text: relLines.length ? `【关系】\n${relLines.join('\n')}` : '', priority: 4 });

  // 3. 大纲树（缩进还原层级）
  const outlineText = renderOutline(world.outline ?? []);
  sections.push({ key: 'outline', text: outlineText, priority: 4 });

  // 4. 时间线
  if (includeTimeline) {
    const tlParts: string[] = [];
    for (const tl of world.timelines ?? []) {
      const events = (tl.events ?? []).slice(0, maxTimelineEvents);
      const lines = events.map((ev) => `- ${ev.label ?? ev.id}`); // TimelineEvent.label 为事件标题
      tlParts.push(`【时间线：${tl.name ?? tl.id}】\n${lines.join('\n')}`);
    }
    sections.push({ key: 'timeline', text: tlParts.join('\n\n'), priority: 2 });
  }

  // 5. 文档（仅标题，低优先级）
  if (includeDocs) {
    const docLines = (world.docs ?? []).map((d) => `- ${d.title ?? d.id}`);
    sections.push({ key: 'docs', text: docLines.length ? `【文档】\n${docLines.join('\n')}` : '', priority: 1 });
  }

  // —— 预算裁减：从低优先级段开始丢弃 ——
  const sorted = [...sections].sort((a, b) => b.priority - a.priority);
  const kept: string[] = [];
  let total = 0;
  let truncated = false;
  for (const sec of sorted) {
    if (!sec.text) continue;
    const t = estimateTokens(sec.text);
    if (total + t > tokenBudget) {
      // 本段超预算：若该段是最高优先级实体段，仍保留（宁超不丢硬设定）；否则丢弃
      if (sec.key === 'entities' && kept.length === 0) {
        kept.push(sec.text);
        total += t;
      }
      truncated = true;
      continue;
    }
    kept.push(sec.text);
    total += t;
  }

  const text = kept.join('\n\n');
  return {
    text,
    totalTokens: total,
    truncated,
    stats: {
      entities: entities.length,
      relations: relations.length,
      outlineNodes: (world.outline ?? []).length,
      timelineEvents: (world.timelines ?? []).reduce((n, tl) => n + (tl.events ?? []).length, 0),
      docs: (world.docs ?? []).length,
    },
  };
}

/** 大纲树 → 缩进文本（任意深度） */
function renderOutline(outline: WorldData['outline']): string {
  const tree = treeify(outline ?? []);
  if (tree.length === 0) return '';
  const lines: string[] = [];
  const walk = (nodes: ReturnType<typeof treeify>, depth: number) => {
    for (const n of nodes) {
      const mark = n.status === 'done' ? '[done] ' : '';
      lines.push(`${'  '.repeat(depth)}- ${mark}${OUTLINE_KIND_LABEL[n.kind] ?? n.kind}「${n.title}」${n.status !== 'todo' ? `（${OUTLINE_STATUS_LABEL[n.status]}）` : ''}`);
      if (n.children.length) walk(n.children, depth + 1);
    }
  };
  walk(tree, 0);
  return `【大纲】\n${lines.join('\n')}`;
}
