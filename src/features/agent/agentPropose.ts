// ============================================================
// Agent 主动提议引擎（agent方向预览 · 提案队列升级 v1）
// ------------------------------------------------------------
// 规则驱动的「世界变化感知」：在用户导入文章等场景下，检测抽取
// 实体与已有实体的同一性冲突（重名实体），主动生成「信息补全到
// 已有实体」的提案，替代原先的静默去重。
//
// 设计红线：
// 1. 审批层不变：所有改动仍是 updateEntity 提案，经「提案中心」
//    由用户逐条采纳后才落库，agent 绝不静默改数据。
// 2. 只补缺口：合并 patch 仅添加已有实体缺失的字段/标签/笔记，
//    绝不覆盖用户已有数据。
// 3. 检测质量优先：v1 只做归一化精确同名（可信度高）；模糊相似
//    默认关闭——中文短名（2-4 字）编辑距离误报率不可接受。
// 4. 去重记忆：同一 dedupKey（实体+来源名）只提议一次；被拒绝
//    的提案不再重复打扰。
// ============================================================

import type { WikiEntity } from '../../types';
import type { ExtractedEntity } from '../ai/articleExtract';
import { useWorldStore } from '../../store/worldStore';

/** 名称归一化：去首尾空格、压缩空白、转小写（用于精确比对） */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '');
}

/** 是否启用模糊相似匹配（默认关闭，防误报；后续可做成用户设置） */
const ENABLE_FUZZY_MATCH = false;

/** 编辑距离（Levenshtein，滚动数组实现） */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i, ...Array<number>(n).fill(0)];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

/** 判定两个名称是否指向同一事物 */
export function isSameEntity(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (!ENABLE_FUZZY_MATCH) return false;
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen <= 4) return levenshtein(na, nb) <= 1;
  return levenshtein(na, nb) <= 2 || na.includes(nb) || nb.includes(na);
}

/**
 * 计算「把 incoming 补全进 existing」的 patch。
 * 只补缺口：字段按 label 去重、标签按并集、笔记仅在已有为空时写入。
 * 无任何可补内容时返回 null（不生成无意义的提案）。
 */
export function buildMergePatch(existing: WikiEntity, incoming: ExtractedEntity): Partial<WikiEntity> | null {
  const patch: Partial<WikiEntity> = {};

  const haveField = new Set((existing.fields ?? []).map((f) => normalizeName(f.label)));
  const newFields = (incoming.fields ?? []).filter(
    (f) => f.value && f.value.trim() && !haveField.has(normalizeName(f.label)),
  );
  if (newFields.length) patch.fields = [...(existing.fields ?? []), ...newFields];

  const haveTag = new Set(existing.tags ?? []);
  const newTags = (incoming.tags ?? [])
    .map((t) => t.trim())
    .filter((t) => t && !haveTag.has(t));
  if (newTags.length) patch.tags = [...(existing.tags ?? []), ...newTags];

  if (!existing.note && incoming.note?.trim()) patch.note = incoming.note.trim();

  return Object.keys(patch).length ? patch : null;
}

/** 同一 dedupKey 是否已提议过（含已处理：拒绝过的不再打扰） */
export function isAlreadyProposed(dedupKey: string): boolean {
  const ws = useWorldStore.getState();
  const wd = ws.worldsData[ws.current];
  return (wd?.proposals ?? []).some((p) => p.dedupKey === dedupKey);
}

/**
 * 主动提议：文章抽取实体与已有实体为同一事物时，生成「补全已有实体」提案。
 * 返回是否生成了新提案（可合并且未提议过）。
 */
export function proposeEntityMerge(existing: WikiEntity, incoming: ExtractedEntity): boolean {
  const patch = buildMergePatch(existing, incoming);
  if (!patch) return false;

  const dedupKey = `agent:merge:${existing.id}:${normalizeName(incoming.name)}`;
  if (isAlreadyProposed(dedupKey)) return false;

  useWorldStore.getState().addProposal({
    source: 'agent',
    dedupKey,
    op: { kind: 'updateEntity', entityId: existing.id, patch },
    summary: `检测到「${incoming.name}」与已有实体「${existing.name}」为同一事物，建议将文章信息补全进去`,
  });
  return true;
}
