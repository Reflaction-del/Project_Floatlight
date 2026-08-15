// ============================================================
// 世界模板（Phase 5 插件市场雏形）
// ------------------------------------------------------------
// 将世界核心数据（实体/关系/时间线/大纲/文档/风格/模板/规则书）
// 打包为 .fuguworld 文件（纯本地，零在线依赖），可导入创建新世界。
// 与既有 .fugu* 系列（模板/风格/规则书）同属本地插件生态。
// ============================================================
import type { WorldData } from '../../store/worldStore';

export interface WorldTemplateFile {
  format: 'fugu-world';
  version: 1;
  name: string;
  description?: string;
  exportedAt: number;
  /** 打包的世界核心字段（不含运行时会话数据） */
  world: Partial<Pick<WorldData, 'entities' | 'relations' | 'timelines' | 'outline' | 'docs' | 'folders' | 'styles' | 'templates' | 'materials' | 'rulebooks'>>;
}

/** 打包的核心字段白名单 */
const CORE_FIELDS = [
  'entities', 'relations', 'timelines', 'outline', 'docs', 'folders', 'styles', 'templates', 'materials', 'rulebooks',
] as const;

/** 文件名（带扩展名） */
export function worldTemplateFilename(name: string): string {
  return `${name.replace(/[\\/:*?"<>|]/g, '_') || '世界模板'}.fuguworld`;
}

/** 序列化当前世界为 .fuguworld 文本 */
export function serializeWorldTemplate(
  world: WorldData,
  opts?: { name?: string; description?: string; includeDocs?: boolean },
): string {
  const picked: any = {};
  for (const k of CORE_FIELDS) {
    if (k === 'docs' && opts?.includeDocs === false) continue;
    if (Array.isArray((world as any)[k])) picked[k] = (world as any)[k];
  }
  const file: WorldTemplateFile = {
    format: 'fugu-world',
    version: 1,
    name: opts?.name || '未命名世界模板',
    description: opts?.description,
    exportedAt: Date.now(),
    world: picked,
  };
  return JSON.stringify(file, null, 2);
}

/** 解析 .fuguworld 文本；非法返回 error（不抛异常） */
export function deserializeWorldTemplate(content: string): { template?: WorldTemplateFile; error?: string } {
  if (!content || !content.trim()) return { error: '空文件' };
  let obj: unknown;
  try {
    obj = JSON.parse(content);
  } catch {
    return { error: '不是合法的 JSON 文件' };
  }
  if (!obj || typeof obj !== 'object') return { error: '文件结构无效' };
  const t = obj as Partial<WorldTemplateFile>;
  if (t.format !== 'fugu-world') return { error: '不是 .fuguworld 世界模板（format 应为 fugu-world）' };
  if (t.version !== 1) return { error: `不支持的模板版本：${t.version ?? '未知'}（当前支持 v1）` };
  if (!t.world || typeof t.world !== 'object') return { error: '模板缺少 world 内容' };
  return { template: t as WorldTemplateFile };
}

/** 从模板统计内容量（预览用） */
export function summarizeTemplate(t: WorldTemplateFile): string {
  const w = t.world;
  const count = (k: keyof typeof w) => (Array.isArray(w[k]) ? (w[k] as unknown[]).length : 0);
  return [
    `实体 ${count('entities')}`, `关系 ${count('relations')}`, `时间线 ${count('timelines')}`,
    `大纲节点 ${count('outline')}`, `文档 ${count('docs')}`, `风格 ${count('styles')}`,
    `模板 ${count('templates')}`, `规则书 ${count('rulebooks')}`,
  ].join(' · ');
}
