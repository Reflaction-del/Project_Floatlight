// ============================================================
// 视觉物料生成器 · 批量套系生成面板（P1-B）
// ------------------------------------------------------------
// 选多实体 → 套同一模板 + 风格 → 逐张渲染截图 → 落盘到目录 + manifest。
// 渲染复用 previewToHtml + 离屏截图 IPC，与单张导出像素级一致。
// ============================================================

import { useState } from 'react';
import { getTemplate } from '../templates/registry';
import { renderMaterialHtml } from '../previewToHtml';
import { createDefaultStyleToken } from '../types';
import type { MaterialStyle, PortraitMode, StyleToken } from '../types';
import type { WikiEntity } from '../../../types';
import { buildBatchJobs, runBatch, type BatchItem } from './queue';

/** 模板 pageOverride → 毫米尺寸（与 MaterialForgeView 的 SIZE_PRESETS 对齐） */
const PAGE_SIZES: Record<string, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A5: { w: 148, h: 210 },
  A6: { w: 105, h: 148 },
  square: { w: 210, h: 210 },
  id_card: { w: 85.6, h: 54 },
  poster: { w: 420, h: 594 },
};

interface Props {
  entities: WikiEntity[];
  styles: MaterialStyle[];
  worldName: string;
  initialTemplateId: string | null;
  initialStyleId: string | null;
  initialPortraitMode: PortraitMode;
  initialUseAI: boolean;
  onClose: () => void;
}

export function BatchPanel({
  entities,
  styles,
  worldName,
  initialTemplateId,
  initialStyleId,
  initialPortraitMode,
  initialUseAI,
  onClose,
}: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(entities.map((e) => e.id)),
  );
  const [templateId, setTemplateId] = useState<string>(initialTemplateId ?? 'staffFile');
  const [styleId, setStyleId] = useState<string | null>(initialStyleId);
  const [portraitMode, setPortraitMode] = useState<PortraitMode>(initialPortraitMode);
  const [useAI, setUseAI] = useState<boolean>(initialUseAI);

  const [items, setItems] = useState<BatchItem[]>(() => buildBatchJobs(entities));
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [result, setResult] = useState<{ written: number; folder: string | null } | null>(null);

  const style = styles.find((s) => s.id === styleId) ?? null;
  const token: StyleToken = style?.token ?? createDefaultStyleToken();
  const tmpl = getTemplate(templateId);
  const doneCount = items.filter((i) => i.status === 'done').length;
  const errCount = items.filter((i) => i.status === 'error').length;
  const total = items.length;

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const allSelected = selectedIds.size === entities.length;

  function syncSelection() {
    setItems(buildBatchJobs(entities, selectedIds));
  }

  async function renderOne(entityId: string) {
    const entity = entities.find((e) => e.id === entityId);
    if (!entity || !tmpl) return null;
    const ctx = { entity, worldName, token, portraitMode, useAI, allEntities: entities };
    const key = tmpl.pageOverride ?? 'A4';
    const spec = PAGE_SIZES[key] ?? PAGE_SIZES.A4;
    const html = renderMaterialHtml(tmpl, ctx, {
      page: { page: key, widthMm: spec.w, heightMm: spec.h },
    });
    const wpx = Math.round((spec.w * 96) / 25.4);
    const hpx = Math.round((spec.h * 96) / 25.4);
    const dataUrl =
      (await window.api?.captureMaterialPng?.(html, { width: wpx, height: hpx, scale: 3 })) ?? null;
    if (!dataUrl) return null;
    return { dataUrl, filename: `${tmpl.name}_${entity.name}` };
  }

  async function handleRun() {
    if (!tmpl || total === 0) return;
    setRunning(true);
    setResult(null);
    setMsg('正在批量生成…');
    const res = await runBatch(items, renderOne, (next) => setItems([...next]));
    setRunning(false);
    setMsg(`生成完成：成功 ${res.done} 张，失败 ${res.errors} 张。`);
  }

  async function handleExport() {
    if (doneCount === 0) return;
    const folder = await window.api?.pickFolder?.();
    if (!folder) {
      setMsg('未选择导出目录，已取消。');
      return;
    }
    const payload = items
      .filter((i) => i.status === 'done' && i.dataUrl)
      .map((i) => ({
        filename: i.filename ?? i.entityName,
        dataUrl: i.dataUrl!,
        entityId: i.entityId,
        entityName: i.entityName,
      }));
    setMsg('正在写入文件…');
    const r = await window.api?.materialExportBatch?.(folder, payload);
    if (r && r.written > 0) {
      setResult({ written: r.written, folder: r.folder });
      setMsg(`已导出 ${r.written} 张 PNG + manifest.json 到目录。`);
    } else {
      setMsg('导出失败：' + (r?.error || '未知错误'));
    }
  }

  const progress = total ? Math.round((doneCount / total) * 100) : 0;

  return (
    <div className="mf-modal-backdrop" onClick={onClose}>
      <div className="mf-modal mf-batch-modal" onClick={(e) => e.stopPropagation()}>
        <div className="mf-modal-head">
          <div className="mf-modal-title">批量生成套系</div>
          <button className="mf-modal-x" onClick={onClose} title="关闭">×</button>
        </div>

        <div className="mf-batch-body">
          {/* 左：实体多选 */}
          <div className="mf-batch-entities">
            <div className="mf-batch-entities-head">
              <span>实体（{selectedIds.size}/{entities.length}）</span>
              <button
                className="mf-link-btn"
                onClick={() => {
                  setSelectedIds(allSelected ? new Set() : new Set(entities.map((e) => e.id)));
                  syncSelection();
                }}
              >
                {allSelected ? '清空' : '全选'}
              </button>
            </div>
            <div className="mf-batch-entity-list">
              {entities.map((e) => (
                <label key={e.id} className="mf-check-row">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(e.id)}
                    onChange={() => toggle(e.id)}
                  />
                  <span>{e.name}</span>
                  <span className="mf-check-sub">{e.type}</span>
                </label>
              ))}
            </div>
          </div>

          {/* 右：选项 + 运行 */}
          <div className="mf-batch-options">
            <div className="mf-field">
              <label>模板</label>
              <select value={templateId} onChange={(ev) => setTemplateId(ev.target.value)}>
                <option value="staffFile">员工 / 角色档案</option>
                <option value="idCard">证件 / ID 卡</option>
                <option value="menu">日常 / 菜单</option>
                <option value="roster">名册 / 关系名单</option>
              </select>
            </div>
            <div className="mf-field">
              <label>风格</label>
              <select
                value={styleId ?? ''}
                onChange={(ev) => setStyleId(ev.target.value || null)}
              >
                <option value="">默认（自动生成）</option>
                {styles.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className="mf-field">
              <label>头像来源</label>
              <div className="mf-seg">
                {(['entity', 'upload', 'ai'] as PortraitMode[]).map((m) => (
                  <button
                    key={m}
                    className={'mf-seg-btn' + (portraitMode === m ? ' active' : '')}
                    onClick={() => setPortraitMode(m)}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
            <div className="mf-field mf-field-row">
              <label>AI 增强</label>
              <input type="checkbox" checked={useAI} onChange={(e) => setUseAI(e.target.checked)} />
            </div>

            <button
              className="mf-export-btn mf-export-primary"
              style={{ width: '100%', marginTop: 8 }}
              disabled={running || total === 0}
              onClick={handleRun}
            >
              {running ? '生成中…' : `开始批量生成（${total} 张）`}
            </button>
            <button
              className="mf-export-btn"
              style={{ width: '100%', marginTop: 8 }}
              disabled={running || doneCount === 0}
              onClick={handleExport}
            >
              导出到目录（{doneCount} 张）
            </button>

            {msg && <div className="mf-export-status">{msg}</div>}
            {result && (
              <div className="mf-batch-result">
                已写入：<code>{result.folder}</code>
              </div>
            )}

            {total > 0 && (
              <div className="mf-batch-progress">
                <div className="mf-progress-bar">
                  <div className="mf-progress-fill" style={{ width: `${progress}%` }} />
                </div>
                <div className="mf-progress-text">
                  成功 {doneCount} · 失败 {errCount} · 共 {total}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
