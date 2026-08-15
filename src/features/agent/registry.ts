// ============================================================
// Agent 工具注册表（Phase 2 单 Agent 编排）
// ------------------------------------------------------------
// Service 注册表模式（借鉴 DeepSeek Harness 的 pre/execute/post 三段式，
// 不引 YAML）：能力工具统一走 pre（写库前校验/拒绝）→ execute → post。
//
// 本文件首批收敛「确定性/只读」工具（均携带世界数据，动态构造）：
//   search_entities / get_entity（复用 aiTools 语义检索，走 base）
//   outline.get（大纲树文本） · consistency.scan（一致性扫描）
//   memory.snapshot（世界快照）
// 写操作类工具（propose）由提案队列承接，不在此直接落库（审批层红线）。
// 未来插件化工具（规则引擎/骰子/跑团）经 registerTool 注册。
// ============================================================

import type { WorldData } from '../../store/worldStore';
import { makeWorldTools } from '../../utils/aiTools';
import { scanConflicts } from '../../utils/consistency';
import { treeify } from '../outline/outlineOps';
import { OUTLINE_KIND_LABEL, OUTLINE_STATUS_LABEL } from '../outline/types';
import { buildWorldSnapshot } from './snapshot';
import type { ToolContext, ToolDef } from '../../utils/ai';

/** 工具执行钩子：写世界库前的一致性/权限校验等（返回错误字符串则拒绝执行） */
export type ToolPreHook = (args: Record<string, unknown>) => string | null;

/** 工具定义（注册表统一形态） */
export interface AgentToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  pre?: ToolPreHook;
  execute: (args: Record<string, unknown>) => Promise<string> | string;
  post?: (args: Record<string, unknown>, result: string) => void;
}

/** 构造工具上下文时的输入（世界数据 + 可选执行回调） */
export interface ToolBuildContext {
  world: WorldData;
  /** 允许启用的工具名子集（空 = 全部） */
  enabled?: string[];
  /** Trace 采集回调 */
  onToolCall?: (name: string, args: unknown) => void;
  onToolResult?: (name: string, result: string) => void;
}

const registry = new Map<string, AgentToolDef>();

/** 插件化注册（未来规则引擎/骰子等外部能力接入点） */
export function registerTool(def: AgentToolDef): void {
  registry.set(def.name, def);
}

export function getTool(name: string): AgentToolDef | undefined {
  return registry.get(name);
}

export function listTools(): AgentToolDef[] {
  return [...registry.values()];
}

/** 执行单个工具（pre → execute → post，统一异常兜底） */
async function executeTool(def: AgentToolDef, args: Record<string, unknown>): Promise<string> {
  if (def.pre) {
    const reject = def.pre(args);
    if (reject) return reject;
  }
  try {
    const result = await def.execute(args);
    const text = typeof result === 'string' ? result : JSON.stringify(result);
    def.post?.(args, text);
    return text;
  } catch (e) {
    return '（工具执行失败：' + String(e) + '）';
  }
}

/** 动态工具（携带世界数据，在 buildToolContext 内构造） */
function dynamicTools(ctx: ToolBuildContext): AgentToolDef[] {
  return [
    {
      name: 'outline.get',
      description: '获取当前世界全局大纲全文（任意深度树，含类型与状态）。写章节前先看大纲，了解剧情结构与当前进度。',
      parameters: { type: 'object', properties: {} },
      execute: () => {
        const tree = treeify(ctx.world.outline ?? []);
        if (tree.length === 0) return '（当前世界暂无大纲）';
        const lines: string[] = [];
        const walk = (nodes: typeof tree, depth: number) => {
          for (const n of nodes) {
            lines.push(
              `${'  '.repeat(depth)}- ${OUTLINE_KIND_LABEL[n.kind] ?? n.kind}「${n.title}」` +
                (n.status !== 'todo' ? `（${OUTLINE_STATUS_LABEL[n.status]}）` : ''),
            );
            if (n.children.length) walk(n.children, depth + 1);
          }
        };
        walk(tree, 0);
        return `【大纲】\n${lines.join('\n')}`;
      },
    },
    {
      name: 'consistency.scan',
      description: '扫描世界观设定的一致性冲突（重名实体/空名/悬空关系/孤立实体/对称缺失/重复关系），返回冲突清单与统计。用于写入新设定前自检，或回答"当前世界有哪些设定问题"。',
      parameters: {
        type: 'object',
        properties: {
          disabledWeak: { type: 'array', items: { type: 'string' }, description: '需要关闭的弱规则 id（symmetry/orphan-entity/duplicate-relation）' },
        },
      },
      execute: (args) => {
        const disabledWeak = Array.isArray(args.disabledWeak) ? args.disabledWeak.map(String) : undefined;
        const conflicts = scanConflicts(ctx.world.entities ?? [], ctx.world.relations ?? [], { disabledWeak });
        if (conflicts.length === 0) return '（一致性检查通过，无冲突）';
        const strong = conflicts.filter((c) => c.severity === 'strong').length;
        return (
          `发现 ${conflicts.length} 处冲突（强 ${strong} / 弱 ${conflicts.length - strong}）：\n` +
          conflicts.map((c) => `- [${c.severity}] ${c.message}`).join('\n')
        );
      },
    },
    {
      name: 'memory.snapshot',
      description: '获取当前世界认知快照：核心实体（最近更新优先）、关系、大纲、时间线、文档标题。用于快速建立对世界的整体认知。',
      parameters: {
        type: 'object',
        properties: { tokenBudget: { type: 'number', description: 'token 预算上限，默认 3000' } },
      },
      execute: (args) => {
        const r = buildWorldSnapshot(ctx.world, { tokenBudget: Number(args.tokenBudget) || 3000 });
        return r.text || '（世界为空）';
      },
    },
  ];
}

/**
 * 构造 chatWithTools 兼容的 ToolContext：aiTools（search_entities/get_entity）
 * + 动态工具（outline.get / consistency.scan / memory.snapshot）+ 插件注册表，
 * 统一经 pre→execute→post 执行链，并触发 Trace 采集回调。
 */
export function buildToolContext(ctx: ToolBuildContext): ToolContext {
  const base = makeWorldTools(ctx.world);
  const enabledSet = ctx.enabled && ctx.enabled.length ? new Set(ctx.enabled) : null;

  const defs = [...dynamicTools(ctx), ...registry.values()];
  const tools: ToolDef[] = [
    ...base.tools,
    ...defs.filter((d) => !enabledSet || enabledSet.has(d.name)).map((d) => ({
      name: d.name,
      description: d.description,
      parameters: d.parameters,
    })),
  ];

  const callTool = async (name: string, args: Record<string, unknown>): Promise<string> => {
    ctx.onToolCall?.(name, args);
    const def = defs.find((d) => d.name === name);
    if (def) {
      const result = await executeTool(def, args);
      ctx.onToolResult?.(name, result);
      return result;
    }
    const result = await base.callTool(name, args); // aiTools 原生（search/get）
    ctx.onToolResult?.(name, result);
    return result;
  };

  return { tools, callTool };
}
