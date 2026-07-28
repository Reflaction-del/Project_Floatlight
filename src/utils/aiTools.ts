// ============================================================
// 世界观工具注册（Tool Calling）
// ------------------------------------------------------------
// 把"按需检索世界观上下文"封装成一组 OpenAI 风格工具，供
// 受过工具训练（supportsTools）的模型在回答前自行调用：
//   - search_entities：按语义/词法检索已有实体（去重/消歧）
//   - get_entity：按 id 拉取实体完整设定
// 这样文章抽取/实体关联等大模型功能无需把候选库灌入 prompt，
// 上下文始终极小，从根本上规避大世界观下的上下文撑爆。
// ============================================================

import type { WikiEntity, WikiRelation } from '../types';
import type { WorldData } from '../store/worldStore';
import { useAIStore } from '../store/aiStore';
import {
  entityBrief,
  retrieveRelevantSemantic,
  retrieveRelevant,
  type Retrieved,
} from './worldContext';
import type { ToolContext, ToolDef } from './ai';

export interface WorldToolOpts {
  /** search_entities 默认返回数量（默认 12） */
  topK?: number;
}

/** 基于当前世界构造工具上下文（工具定义 + 执行器）。 */
export function makeWorldTools(
  world: Pick<WorldData, 'entities' | 'relations'>,
  opts: WorldToolOpts = {},
): ToolContext {
  const topK = opts.topK ?? 12;
  const entities: WikiEntity[] = world.entities ?? [];
  const relations: WikiRelation[] = world.relations ?? [];
  const byId = new Map<string, WikiEntity>(entities.map((e) => [e.id, e]));

  const tools: ToolDef[] = [
    {
      name: 'search_entities',
      description:
        '在已有世界观中检索与查询最相关的实体（角色/势力/地点/事件/规则）。' +
        '用于在抽取或关联时确认某个名字是否已存在、避免重复创建，或对文中提及做消歧。' +
        '返回实体摘要列表（含 id、名称、类型、标签、关系）。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '检索词，例如"主角所属的帝国"或某个实体名称片段' },
          limit: { type: 'number', description: '返回数量上限，默认 8' },
        },
        required: ['query'],
      },
    },
    {
      name: 'get_entity',
      description: '根据实体 id 获取完整设定（类型、字段、标签、备注、关系）。需要在确切已知实体 id 时查看其详情再决定如何关联/去重。',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: '实体 id' } },
        required: ['id'],
      },
    },
  ];

  const callTool = async (name: string, args: Record<string, unknown>): Promise<string> => {
    if (name === 'search_entities') {
      const q = String(args.query ?? '');
      if (!q.trim()) return '（查询为空）';
      const lim = Math.min(20, Math.max(1, Number(args.limit ?? topK) || topK));
      const useEmb = !!useAIStore.getState().embeddingModel;
      let retrieved: Retrieved[];
      try {
        retrieved = useEmb ? await retrieveRelevantSemantic(world, q, lim) : retrieveRelevant(world, q, lim);
      } catch {
        retrieved = retrieveRelevant(world, q, lim);
      }
      if (retrieved.length === 0) return '（未找到相关实体）';
      return retrieved.map((r) => entityBrief(r.entity, r.related, byId)).join('\n\n');
    }
    if (name === 'get_entity') {
      const id = String(args.id ?? '');
      const e = entities.find((x) => x.id === id);
      if (!e) return '（未找到该 id 的实体）';
      const rels = relations.filter((r) => r.source === id || r.target === id);
      return entityBrief(e, rels, byId);
    }
    return '（未知工具）';
  };

  return { tools, callTool };
}
