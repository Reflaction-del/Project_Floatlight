// ============================================================
// 规则书 .fugurule 导入导出（Phase 4a）
// ------------------------------------------------------------
// 沿用 fugu* 纯本地格式族：规则书序列化为 .fugurule JSON，
// 导入时做结构校验（防坏文件/非法数据）。版权红线：用户导入的
// 完整规则书（DND5e/COC7 原版数据）属用户自有内容，仅本地存储。
// ============================================================

import type { Rulebook } from './types';

export const FUGURULE_EXT = '.fugurule';

/** 序列化规则书为 .fugurule 内容（含版本头，便于未来迁移） */
export function serializeRulebook(rb: Rulebook): string {
  return JSON.stringify(
    {
      format: 'floatlight-rulebook',
      version: 1,
      rulebook: rb,
    },
    null,
    2,
  );
}

/** 校验并反序列化 .fugurule 内容；非法返回错误信息 */
export function deserializeRulebook(raw: string): { rulebook?: Rulebook; error?: string } {
  let obj: any;
  try {
    obj = JSON.parse(raw || '{}');
  } catch {
    return { error: '不是有效的 JSON 文件' };
  }
  const rb = obj.rulebook && typeof obj.rulebook === 'object' ? obj.rulebook : obj;
  if (typeof rb.name !== 'string' || !rb.name.trim()) return { error: '缺少规则书名（name）' };
  if (typeof rb.dice !== 'string' || !/^\d*d\d+/.test(rb.dice)) return { error: '缺少有效默认骰子（dice，如 1d20）' };
  if (typeof rb.formula !== 'string' || !rb.formula.includes('{')) return { error: '缺少有效检定公式（formula，需含 {attr}/{skill} 变量）' };
  if (!Array.isArray(rb.stats) || rb.stats.length === 0) return { error: '缺少属性列表（stats）' };
  if (!Array.isArray(rb.skills)) return { error: '缺少技能列表（skills）' };
  if (typeof rb.difficulty !== 'object' || rb.difficulty === null || Object.keys(rb.difficulty).length === 0) {
    return { error: '缺少难度阈值表（difficulty）' };
  }
  const rulebook: Rulebook = {
    id: typeof rb.id === 'string' && rb.id ? rb.id : `rb-${Date.now().toString(36)}`,
    name: rb.name.trim().slice(0, 60),
    universe: typeof rb.universe === 'string' ? rb.universe : 'custom',
    dice: rb.dice,
    stats: rb.stats.map(String),
    skills: Array.isArray(rb.skills)
      ? rb.skills.map((s: any) => ({ name: String(s?.name ?? ''), base: String(s?.base ?? '') })).filter((s: { name: string }) => s.name)
      : [],
    formula: rb.formula,
    difficulty: Object.fromEntries(Object.entries(rb.difficulty).map(([k, v]) => [k, Number(v) || 0])),
    meta: typeof rb.meta === 'string' ? rb.meta : '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  return { rulebook };
}

/** 生成下载文件名（桌面版走 fs-export，浏览器走 blob） */
export function rulebookFilename(name: string): string {
  const safe = name.replace(/[\\/:*?"<>|]/g, '_');
  return `规则书_${safe || '未命名'}${FUGURULE_EXT}`;
}
