// ============================================================
// 文档标题冲突检测（修复：创建/重命名同名文档无检查）
// ------------------------------------------------------------
// 纯函数：全局按 title 查重（tab 标题全局显示，故按全局而非
// 同文件夹）；创建时自动加序号（对齐文件夹 uniqFolder 行为），
// 重命名时由调用方阻止冲突。
// ============================================================
import type { DocFile } from '../types';

/** 全局文档标题查重（排除 excludeId）；返回首个冲突文档或 null */
export function findDocTitleConflict(docs: DocFile[] | undefined, title: string, excludeId?: string): DocFile | null {
  const t = (title || '').trim();
  if (!t) return null;
  return (docs ?? []).find((d) => d.title === t && d.id !== excludeId) ?? null;
}

/** 是否存在全局同名文档 */
export function hasDocTitleConflict(docs: DocFile[] | undefined, title: string, excludeId?: string): boolean {
  return findDocTitleConflict(docs, title, excludeId) !== null;
}

/**
 * 生成不冲突的文档标题：
 * - base 无冲突 → 原样返回
 * - 有冲突 → 「base（2）」「base（3）」… 直到不冲突
 * - 空标题回退「未命名」
 */
export function uniqueDocTitle(docs: DocFile[] | undefined, base: string): string {
  const b = (base || '').trim() || '未命名';
  if (!hasDocTitleConflict(docs, b)) return b;
  let n = 2;
  while (hasDocTitleConflict(docs, `${b}（${n}）`)) n++;
  return `${b}（${n}）`;
}
