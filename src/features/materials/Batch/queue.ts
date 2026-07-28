// ============================================================
// 视觉物料生成器 · 批量套系队列（P1-B）
// ------------------------------------------------------------
// 纯编排层：把选中的实体逐个「渲染 → 截图 → 收集」，
// 不依赖具体渲染实现（renderOne 由面板注入，便于复用离屏 IPC）。
// 顺序执行（并发 1）以避免同时开多个离屏窗口把桌面环境压垮。
// ============================================================

export type BatchStatus = 'pending' | 'running' | 'done' | 'error';

export interface BatchItem {
  id: string;
  entityId: string;
  entityName: string;
  status: BatchStatus;
  error?: string;
  dataUrl?: string;
  filename?: string;
}

export interface BatchResult {
  done: number;
  errors: number;
}

/** 由实体列表构建初始队列（默认全选） */
export function buildBatchJobs(
  entities: { id: string; name: string }[],
  selectedIds?: Set<string>,
): BatchItem[] {
  const picked = selectedIds ?? new Set(entities.map((e) => e.id));
  return entities
    .filter((e) => picked.has(e.id))
    .map((e) => ({
      id: `bj-${e.id}`,
      entityId: e.id,
      entityName: e.name,
      status: 'pending' as BatchStatus,
    }));
}

/**
 * 顺序执行批量任务。
 * @param items      可变队列（会就地更新 status）
 * @param renderOne  渲染单张：传入 entityId，返回 {dataUrl, filename} 或 null（跳过）
 * @param onUpdate   每次状态变化回调（用于刷新进度）
 */
export async function runBatch(
  items: BatchItem[],
  renderOne: (entityId: string) => Promise<{ dataUrl: string; filename: string } | null>,
  onUpdate?: (items: BatchItem[]) => void,
): Promise<BatchResult> {
  let done = 0;
  let errors = 0;

  for (const it of items) {
    it.status = 'running';
    onUpdate?.(items);
    try {
      const r = await renderOne(it.entityId);
      if (r) {
        it.dataUrl = r.dataUrl;
        it.filename = r.filename;
        it.status = 'done';
        done++;
      } else {
        it.status = 'error';
        it.error = '渲染返回空';
        errors++;
      }
    } catch (e: any) {
      it.status = 'error';
      it.error = e?.message || String(e);
      errors++;
    }
    onUpdate?.(items);
  }

  return { done, errors };
}
