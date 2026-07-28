import type {
  WikiEntity,
  WikiRelation,
  RelationType,
  Conflict,
  ConflictSeverity,
} from '../types';
import { RELATION_LABEL, SYMMETRIC_RELATIONS, ENTITY_LABEL } from '../types';

/* ============================================================
 * M3 一致性引擎 —— 规则定义
 * 强规则（strong）：必定为真，违反即视为设定错误（硬伤）
 * 弱规则（weak）：默认开启，但允许在「设定需要」时关闭（软提示）
 * ============================================================ */
export interface RuleConfig {
  id: string;
  name: string;
  severity: ConflictSeverity;
  enabledByDefault: boolean;
  description: string;
}

export const RULES: RuleConfig[] = [
  { id: 'duplicate-name', name: '重名实体', severity: 'strong', enabledByDefault: true, description: '两个实体名称完全相同（忽略大小写与首尾空格）' },
  { id: 'empty-name', name: '空名称实体', severity: 'strong', enabledByDefault: true, description: '实体名称仍为空或保留默认「未命名」' },
  { id: 'dangling-relation', name: '悬空关系', severity: 'strong', enabledByDefault: true, description: '关系连线指向了不存在的实体（数据损坏，需清理）' },
  { id: 'orphan-entity', name: '孤立实体', severity: 'weak', enabledByDefault: true, description: '实体没有任何关系连线，可能是被遗忘的设定' },
  { id: 'symmetry', name: '对称关系缺失', severity: 'weak', enabledByDefault: true, description: '亲缘 / 敌对等对称关系缺少反向连线' },
  { id: 'duplicate-relation', name: '重复关系', severity: 'weak', enabledByDefault: true, description: '相同两实体之间存在重复类型的关系连线' },
];

export interface ScanOptions {
  /** 被关闭的弱规则 id 列表 */
  disabledWeak?: string[];
}

/**
 * 扫描实体与关系，返回所有冲突。
 * 纯函数，便于测试和复用（一致性视图、AI 体检、导出校验等）。
 */
export function scanConflicts(
  entities: WikiEntity[],
  relations: WikiRelation[],
  opts: ScanOptions = {},
): Conflict[] {
  const conflicts: Conflict[] = [];
  const byId = new Map(entities.map((e) => [e.id, e]));
  const disabled = new Set(opts.disabledWeak ?? []);
  const enabled = (r: RuleConfig) => r.severity === 'strong' || !disabled.has(r.id);

  // —— 强：重名实体 ——
  if (enabled(RULES[0])) {
    const seen = new Map<string, WikiEntity>();
    for (const e of entities) {
      const key = (e.name || '').trim().toLowerCase();
      if (!key) continue;
      if (seen.has(key)) {
        const other = seen.get(key)!;
        conflicts.push({
          id: `dup-name-${e.id}`,
          ruleId: 'duplicate-name',
          ruleName: '重名实体',
          severity: 'strong',
          message: `「${e.name}」与「${other.name}」名称重复`,
          entityIds: [e.id, other.id],
        });
      } else {
        seen.set(key, e);
      }
    }
  }

  // —— 强：空名称实体 ——
  if (enabled(RULES[1])) {
    for (const e of entities) {
      const n = (e.name || '').trim();
      if (!n || n === '未命名') {
        conflicts.push({
          id: `empty-${e.id}`,
          ruleId: 'empty-name',
          ruleName: '空名称实体',
          severity: 'strong',
          message: `「${ENTITY_LABEL[e.type]}」实体缺少名称`,
          entityIds: [e.id],
        });
      }
    }
  }

  // —— 强：悬空关系 ——
  if (enabled(RULES[2])) {
    for (const r of relations) {
      const sOk = byId.has(r.source);
      const tOk = byId.has(r.target);
      if (!sOk || !tOk) {
        conflicts.push({
          id: `dangling-${r.id}`,
          ruleId: 'dangling-relation',
          ruleName: '悬空关系',
          severity: 'strong',
          message: `关系 ${RELATION_LABEL[r.type] || r.type} 指向了不存在的实体（#${r.id.slice(-4)}）`,
          entityIds: [r.source, r.target].filter((id) => byId.has(id)),
        });
      }
    }
  }

  // —— 弱：孤立实体 ——
  if (enabled(RULES[3])) {
    const connected = new Set<string>();
    for (const r of relations) {
      connected.add(r.source);
      connected.add(r.target);
    }
    for (const e of entities) {
      if (!connected.has(e.id)) {
        conflicts.push({
          id: `orphan-${e.id}`,
          ruleId: 'orphan-entity',
          ruleName: '孤立实体',
          severity: 'weak',
          message: `「${e.name}」没有任何关系连线`,
          entityIds: [e.id],
        });
      }
    }
  }

  // —— 弱：对称关系缺失反向 ——
  if (enabled(RULES[4])) {
    const hasReverse = (s: string, t: string, type: RelationType) =>
      relations.some((r) => r.source === t && r.target === s && r.type === type);
    for (const r of relations) {
      if (SYMMETRIC_RELATIONS.includes(r.type) && !hasReverse(r.source, r.target, r.type)) {
        const s = byId.get(r.source);
        const t = byId.get(r.target);
        conflicts.push({
          id: `sym-${r.id}`,
          ruleId: 'symmetry',
          ruleName: '对称关系缺失',
          severity: 'weak',
          message: `「${s?.name}」→「${t?.name}」的${RELATION_LABEL[r.type]}关系缺少反向连线`,
          entityIds: [r.source, r.target],
        });
      }
    }
  }

  // —— 弱：重复关系 ——
  if (enabled(RULES[5])) {
    const seen = new Set<string>();
    for (const r of relations) {
      const key = [r.source, r.target, r.type].sort().join('|');
      if (seen.has(key)) {
        conflicts.push({
          id: `duprel-${r.id}`,
          ruleId: 'duplicate-relation',
          ruleName: '重复关系',
          severity: 'weak',
          message: `「${byId.get(r.source)?.name}」与「${byId.get(r.target)?.name}」之间存在重复${RELATION_LABEL[r.type]}关系`,
          entityIds: [r.source, r.target],
        });
      } else {
        seen.add(key);
      }
    }
  }

  return conflicts;
}

/** 统计强/弱冲突数量 */
export function summarize(conflicts: Conflict[]) {
  let strong = 0;
  let weak = 0;
  for (const c of conflicts) {
    if (c.severity === 'strong') strong++;
    else weak++;
  }
  return { strong, weak, total: conflicts.length };
}
