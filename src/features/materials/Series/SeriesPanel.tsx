// ============================================================
// 视觉物料生成器 · 套系生成 + 变量矩阵（P3-A）
// ------------------------------------------------------------
// 「套系」= 一组模板（配方）× 一个风格；「变量矩阵」= 同一实体在
// 多个变体轴（头像模式 entity/upload/ai × AI 开关）下出多版本。
// 出图逻辑复用 previewToHtml + 离屏截图 IPC，与单张/批量像素级一致。
// 结果以画廊网格展示，可一键导出到目录（PNG 序列 + manifest）。
// ============================================================

import { useState } from 'react';
import { getTemplate } from '../templates/registry';
import { renderMaterialHtml } from '../previewToHtml';
import { createDefaultStyleToken } from '../types';
import type { MaterialStyle, PortraitMode, StyleToken } from '../types';
import type { WikiEntity } from '../../../types';
import { addGalleryItem } from './galleryStore';

/** 模板 pageOverride → 毫米尺寸（与 BatchPanel / MaterialForgeView 对齐） */
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

type RunStatus = 'pending' | 'running' | 'done' | 'error';

interface SeriesJob {
  id: string;
  entityId: string;
  entityName: string;
  templateId: string;
  templateName: string;
  portraitMode: PortraitMode;
  useAI: boolean;
  status: RunStatus;
  error?: string;
  dataUrl?: string;
  filename?: string;
}

/** 由选择构建「变体轴」组合：头像模式 ×（是否含 AI 变体） */
function buildVariants(
  portraitModes: PortraitMode[],
  includeAI: boolean,
): { portraitMode: PortraitMode; useAI: boolean }[] {
  const out: { portraitMode: PortraitMode; useAI: boolean }[] = [];
  for (const pm of portraitModes) {
    out.push({ portraitMode: pm, useAI: false });
    if (includeAI) out.push({ portraitMode: pm, useAI: true });
  }
  return out;
}

export function SeriesPanel({
  entities,
  styles,
  worldName,
  initialTemplateId,
  initialStyleId,
  initialPortraitMode,
  initialUseAI,
  onClose,
}: Props) {
  const [entityIds, setEntityIds] = useState<Set<string>>(
    () => new Set(entities.map((e) => e.id)),
  );
  const [templateIds, setTemplateIds] = useState<Set<string>>(
    () => new Set(initialTemplateId ? [initialTemplateId] : ['staffFile']),
  );
  const [styleId, setStyleId] = useState<string | null>(initialStyleId);
  const [portraitModes, setPortraitModes] = useState<PortraitMode[]>([initialPortraitMode]);
  const [includeAI, setIncludeAI] = useState<boolean>(initialUseAI);

  const [jobs, setJobs] = useState<SeriesJob[]>([]);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [result, setResult] = useState<{ written: number; folder: string | null } | null>(null);

  const style = styles.find((s) => s.id === styleId) ?? null;
  const token: StyleToken = style?.token ?? createDefaultStyleToken();

  const allTemplates = ['staffFile', 'idCard', 'menu', 'roster'];
  const variants = buildVariants(portraitModes, includeAI);
  const predicted =
    entityIds.size * templateIds.size * Math.max(1, variants.length);

  const doneCount = jobs.filter((j) => j.status === 'done').length;
  const errCount = jobs.filter((j) => j.status === 'error').length;
  const total = jobs.length;

  /* —— 选择操作 —— */
  const toggleEntity = (id: string) =>
    setEntityIds((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleTemplate = (id: string) =>
    setTemplateIds((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const togglePortrait = (m: PortraitMode) =>
    setPortraitModes((p) => (p.includes(m) ? p.filter((x) => x !== m) : [...p, m]));

  function variantLabel(v: { portraitMode: PortraitMode; useAI: boolean }) {
    return `${v.portraitMode}${v.useAI ? '+AI' : ''}`;
  }

  async function renderOne(j: SeriesJob): Promise<{ dataUrl: string; filename: string } | null> {
    const entity = entities.find((e) => e.id === j.entityId);
    const tmpl = getTemplate(j.templateId);
    if (!entity || !tmpl) return null;
    const ctx = {
      entity,
      worldName,
      token,
      portraitMode: j.portraitMode,
      useAI: j.useAI,
      allEntities: entities,
    };
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
    const filename = `${j.entityName}_${tmpl.name}_${variantLabel({ portraitMode: j.portraitMode, useAI: j.useAI })}`;
    return { dataUrl, filename };
  }

  async function handleRun() {
    if (entityIds.size === 0 || templateIds.size === 0 || variants.length === 0) {
      setMsg('请至少选择：1 个实体、1 个模板、1 个变体轴。');
      return;
    }
    const list: SeriesJob[] = [];
    for (const eid of entityIds) {
      const e = entities.find((x) => x.id === eid);
      if (!e) continue;
      for (const tid of templateIds) {
        const t = getTemplate(tid);
        if (!t) continue;
        for (const v of variants) {
          list.push({
            id: `sj-${eid}-${tid}-${v.portraitMode}-${v.useAI}`,
            entityId: eid,
            entityName: e.name,
            templateId: tid,
            templateName: t.name,
            portraitMode: v.portraitMode,
            useAI: v.useAI,
            status: 'pending',
          });
        }
      }
    }
    setJobs(list);
    setRunning(true);
    setResult(null);
    setMsg(`正在生成套系矩阵：共 ${list.length} 张…`);
    let done = 0;
    let errors = 0;
    for (const j of list) {
      j.status = 'running';
      setJobs([...list]);
      try {
        const r = await renderOne(j);
        if (r) {
          j.dataUrl = r.dataUrl;
          j.filename = r.filename;
          j.status = 'done';
          done++;
          // 同步推送到会话画廊
          addGalleryItem({ dataUrl: r.dataUrl, label: r.filename });
        } else {
          j.status = 'error';
          j.error = '截图返回空';
          errors++;
        }
      } catch (e: any) {
        j.status = 'error';
        j.error = e?.message || String(e);
        errors++;
      }
      setJobs([...list]);
    }
    setRunning(false);
    setMsg(`生成完成：成功 ${done} 张，失败 ${errors} 张。`);
  }

  async function handleExport() {
    const done = jobs.filter((j) => j.status === 'done' && j.dataUrl);
    if (done.length === 0) return;
    const folder = await window.api?.pickFolder?.();
    if (!folder) { setMsg('未选择导出目录，已取消。'); return; }
    const payload = done.map((j) => ({
      filename: j.filename ?? `${j.entityName}_${j.templateName}`,
      dataUrl: j.dataUrl!,
      entityId: j.entityId,
      entityName: j.entityName,
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
      <div className="mf-modal mf-series-modal" onClick={(e) => e.stopPropagation()}>
        <div className="mf-modal-head">
          <div className="mf-modal-title">套系生成 · 变量矩阵</div>
          <button className="mf-modal-x" onClick={onClose} title="关闭">×</button>
        </div>

        <div className="mf-series-body">
          {/* 左：实体 + 模板 + 变体轴 */}
          <div className="mf-series-cfg">
            <div className="mf-batch-entities-head">
              <span>实体（{entityIds.size}/{entities.length}）</span>
              <button className="mf-link-btn" onClick={() => setEntityIds(new Set(entities.map((e) => e.id)))}>全选</button>
              <button className="mf-link-btn" onClick={() => setEntityIds(new Set())}>清空</button>
            </div>
            <div className="mf-batch-entity-list">
              {entities.map((e) => (
                <label key={e.id} className="mf-check-row">
                  <input type="checkbox" checked={entityIds.has(e.id)} onChange={() => toggleEntity(e.id)} />
                  <span>{e.name}</span>
                  <span className="mf-check-sub">{e.type}</span>
                </label>
              ))}
            </div>

            <div className="mf-field" style={{ marginTop: 10 }}>
              <label>套系模板（可多选）</label>
              <div className="mf-chip-row">
                {allTemplates.map((tid) => {
                  const t = getTemplate(tid);
                  const on = templateIds.has(tid);
                  return (
                    <button
                      key={tid}
                      className={'mf-chip' + (on ? ' active' : '')}
                      onClick={() => toggleTemplate(tid)}
                    >{t?.name ?? tid}</button>
                  );
                })}
              </div>
            </div>

            <div className="mf-field">
              <label>风格</label>
              <select value={styleId ?? ''} onChange={(ev) => setStyleId(ev.target.value || null)}>
                <option value="">默认（自动生成）</option>
                {styles.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
              </select>
            </div>

            <div className="mf-field">
              <label>变量轴 · 头像模式</label>
              <div className="mf-chip-row">
                {(['entity', 'upload', 'ai'] as PortraitMode[]).map((m) => (
                  <button
                    key={m}
                    className={'mf-chip' + (portraitModes.includes(m) ? ' active' : '')}
                    onClick={() => togglePortrait(m)}
                  >{m}</button>
                ))}
              </div>
            </div>

            <div className="mf-field mf-field-row">
              <label>变量轴 · 含 AI 变体（useAI=true）</label>
              <input type="checkbox" checked={includeAI} onChange={(e) => setIncludeAI(e.target.checked)} />
            </div>

            <div className="mf-series-predict">
              预计出图：<b>{predicted}</b> 张（实体 {entityIds.size} × 模板 {templateIds.size} × 变体 {Math.max(1, variants.length)}）
            </div>

            <button
              className="mf-export-btn mf-export-primary"
              style={{ width: '100%', marginTop: 8 }}
              disabled={running}
              onClick={handleRun}
            >
              {running ? '生成中…' : `开始生成套系（${predicted} 张）`}
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
            {result && <div className="mf-batch-result">已写入：<code>{result.folder}</code></div>}
            {total > 0 && (
              <div className="mf-batch-progress">
                <div className="mf-progress-bar">
                  <div className="mf-progress-fill" style={{ width: `${progress}%` }} />
                </div>
                <div className="mf-progress-text">成功 {doneCount} · 失败 {errCount} · 共 {total}</div>
              </div>
            )}
          </div>

          {/* 右：结果画廊网格 */}
          <div className="mf-series-gallery">
            <div className="mf-series-gallery-head">结果画廊（{doneCount} 张）</div>
            {doneCount === 0 ? (
              <div className="mf-empty" style={{ fontSize: 13 }}>
                生成后在此查看套系矩阵缩略图，可框选导出。
              </div>
            ) : (
              <div className="mf-gallery-grid">
                {jobs.filter((j) => j.status === 'done' && j.dataUrl).map((j) => (
                  <div className="mf-gallery-item" key={j.id}>
                    <img src={j.dataUrl} alt={j.filename} title={j.filename} />
                    <div className="mf-gallery-cap">{j.entityName} · {j.templateName}</div>
                    <div className="mf-gallery-sub">{variantLabel({ portraitMode: j.portraitMode, useAI: j.useAI })}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
