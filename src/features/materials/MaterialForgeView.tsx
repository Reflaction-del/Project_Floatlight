// ============================================================
// 视觉物料生成器 · 三栏主界面（P0-2）
// ------------------------------------------------------------
// 左：模板 + 风格列表；中：预览（当前按风格令牌渲染占位骨架，
//     真实 Block 渲染在 P0-5 接入）；右：属性面板（预览实体 /
//     头像来源 / AI 开关 / 缩放 / 导出占位）。
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { useWorldStore } from '../../store/worldStore';
import { useWorldviewStore } from '../../store/worldviewStore';
import { useMaterialStore } from './store';
import { MATERIAL_TEMPLATES, getTemplate } from './templates/registry';
import { createDefaultStyleToken } from './types';
import { StyleEditor } from './StyleEditor';
import { BatchPanel } from './Batch/BatchPanel';
import { ConsistencyPanel } from './Consistency/ConsistencyPanel';
import { SeriesPanel } from './Series/SeriesPanel';
import { GalleryModal } from './Series/GalleryModal';
import { TemplateEditor } from './TemplateEditor';
import { MarketPanel } from './MarketPanel';
import { TemplateGenModal } from '../../components/TemplateGenModal';
import { SceneCardModal } from '../../components/SceneCardModal';
import { renderMaterialHtml } from './previewToHtml';
import { renderMaterialSvg } from './SvgRenderer';
import { MaterialPreview } from './Preview';
import { collectAIFields, type RenderContext } from './bindings';
import { useGalleryStore } from './Series/galleryStore';
import type { MaterialStyle, MaterialTemplate, PortraitMode, StyleToken } from './types';
import { SIZE_PRESETS, CATEGORY_LABELS } from './types';
import { getCurrentModel, generateImage, chatOnce } from '../../utils/ai';
import { buildAvatarPrompt } from './aiPrompt';

export function MaterialForgeView() {
  const styles = useWorldStore((s) => s.worldsData[s.current]?.styles ?? []);
  const entities = useWorldStore((s) => s.worldsData[s.current]?.entities ?? []);
  const userTemplates = useWorldStore((s) => s.worldsData[s.current]?.templates ?? []);
  const addStyle = useWorldStore((s) => s.addStyle);
  const deleteStyle = useWorldStore((s) => s.deleteStyle);
  const updateEntity = useWorldStore((s) => s.updateEntity);
  const worldview = useWorldviewStore();
  const worldName = worldview.worlds.find((w) => w.name === worldview.current)?.name ?? '世界观';

  const ui = useMaterialStore();
  const [editingStyleId, setEditingStyleId] = useState<string | null>(null);
  const editingStyle: MaterialStyle | undefined = styles.find((s) => s.id === editingStyleId);
  const [showBatch, setShowBatch] = useState(false);
  const [showConsistency, setShowConsistency] = useState(false);
  const [showSeries, setShowSeries] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [showTemplateEditor, setShowTemplateEditor] = useState(false);
  const [showMarket, setShowMarket] = useState(false);
  const [showTplGen, setShowTplGen] = useState(false);
  const [showScene, setShowScene] = useState(false);
  // 预览区 DOM 引用，用于直接截图导出（WYSIWYG）
  const previewRef = useRef<HTMLDivElement>(null);
  // P2-D：AI 字段自动补全（生成结果经提案队列由用户采纳，不再用局部 aiValues 待审核态）
  const [aiFillBusy, setAiFillBusy] = useState(false);
  const [aiFillMsg, setAiFillMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const activeTemplate = getTemplate(ui.activeTemplateId, userTemplates);
  const activeStyle: MaterialStyle | undefined = styles.find((s) => s.id === ui.activeStyleId);
  const token: StyleToken = activeStyle?.token ?? createDefaultStyleToken();
  const activeEntity = entities.find((e) => e.id === ui.previewEntityId);
  const ctx: RenderContext = {
    entity: activeEntity ?? null,
    worldName,
    token,
    portraitMode: ui.portraitMode,
    useAI: ui.useAI,
    allEntities: entities,
    aiValues: {},
  };

  const header = (token.layout.header ?? '{worldName}').replace(/\{worldName\}/g, worldName);

  // —— 导出状态与尺寸预设（P0-7） ——
  // 模板 pageOverride 决定版式；无覆盖时才跟随当前风格的 layout.page。
  const defaultExportPage = activeTemplate?.pageOverride ?? activeStyle?.token.layout.page ?? 'A4';
  const [exportPage, setExportPage] = useState<string>(defaultExportPage);
  const [status, setStatus] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [aiFieldKey, setAiFieldKey] = useState('ai_bio');
  const [aiTextBusy, setAiTextBusy] = useState(false);
  const [aiTextMsg, setAiTextMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  // 切换模板 / 风格时，导出尺寸应同步变化以匹配预览；
  // 同时监听风格自身画幅（layout.page）的变化——在风格编辑器里改了画幅后，
  // 回到可视化编辑器也能立即跟随，做到「输出尺寸默认与当前风格相对应」。
  useEffect(() => {
    const next = activeTemplate?.pageOverride ?? activeStyle?.token.layout.page ?? 'A4';
    setExportPage(next);
  }, [activeTemplate?.id, activeStyle?.id, activeStyle?.token.layout.page]);

  const spec = SIZE_PRESETS.find((p) => p.key === exportPage) ?? SIZE_PRESETS[0];
  const specW = spec.key === 'custom' ? token.layout.widthMm : spec.w;
  const specH = spec.key === 'custom' ? token.layout.heightMm : spec.h;
  const pxW = Math.round(specW * 96 / 25.4);
  const pxH = Math.round(specH * 96 / 25.4);
  const defaultName = `${worldName}_${activeTemplate?.name ?? 'material'}_${activeEntity?.name ?? '无主体'}`;
  const buildHtml = () =>
    activeTemplate ? renderMaterialHtml(activeTemplate, ctx, { page: { page: spec.key, widthMm: specW, heightMm: specH } }) : '';

  // 直接截取编辑器内的实时预览图导出（所见即所得）
  async function handleExportPreview() {
    if (!activeTemplate || !previewRef.current) return;
    const rect = previewRef.current.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    setStatus('正在导出预览图…');
    try {
      const ok = await (window.api?.exportPreviewPng?.(
        { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        defaultName,
      ) ?? false);
      setStatus(ok ? '已导出预览图 ✓' : '已取消或导出失败');
    } catch {
      setStatus('导出预览图出错');
    }
  }

  async function handleExport(kind: 'png' | 'pdf') {
    if (!activeTemplate) return;
    const html = buildHtml();
    if (!html) return;
    setStatus(kind === 'png' ? '正在导出 PNG…' : '正在导出 PDF…');
    try {
      const ok =
        kind === 'png'
          ? await (window.api?.exportMaterialPng?.(html, { width: pxW, height: pxH, scale: 3, defaultName }) ?? false)
          : await (window.api?.exportMaterialPdf?.(html, { widthMm: specW, heightMm: specH, defaultName }) ?? false);
      if (ok && kind === 'png') {
        // 单张导出后也收进会话画廊（P3-B）
        const du = await (window.api?.captureMaterialPng?.(html, { width: pxW, height: pxH, scale: 2 }) ?? null);
        if (du) useGalleryStore.getState().add({ dataUrl: du, label: defaultName });
      }
      setStatus(ok ? `已导出 ${kind.toUpperCase()} ✓` : '已取消或导出失败');
    } catch {
      setStatus('导出出错');
    }
  }

  async function handleCopySocial() {
    if (!activeTemplate) return;
    const html = buildHtml();
    if (!html) return;
    setStatus('正在生成分享图…');
    try {
      const dataUrl = await (window.api?.captureMaterialPng?.(html, { width: pxW, height: pxH, scale: 2 }) ?? null);
      if (!dataUrl) { setStatus('截图失败'); return; }
      const blob = await (await fetch(dataUrl)).blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setStatus('已复制图片到剪贴板 ✓');
    } catch {
      setStatus('复制失败（浏览器/剪贴板限制）');
    }
  }

  /** P3-B：导出矢量 SVG。纯渲染进程生成（无需 IPC），直接下载 blob。 */
  function handleExportSvg() {
    if (!activeTemplate) return;
    const svg = renderMaterialSvg(activeTemplate, ctx, { page: { page: spec.key, widthMm: specW, heightMm: specH } });
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${defaultName}.svg`;
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus('已导出 SVG（矢量）✓');
  }

  /** P1-A：生成 AI 头像（OpenAI 兼容文生图），写回 entity.portrait.aiSrc。
   *  refImage 取现有 aiSrc（或首张实体插图），实现「同角色一致」锁定。 */
  async function handleGenAvatar() {
    if (!activeEntity) {
      setAiMsg({ kind: 'err', text: '请先在「预览实体」选择角色。' });
      return;
    }
    const model = getCurrentModel();
    if (!model) {
      setAiMsg({ kind: 'err', text: '未配置文生图模型：请打开 设置 → 大模型接入 添加（endpoint / api_key / model）。' });
      return;
    }
    setAiBusy(true);
    setAiMsg(null);
    try {
      const ref = activeEntity.portrait?.aiSrc || activeEntity.images?.[0]?.dataUrl || undefined;
      const prompt = buildAvatarPrompt(activeEntity, token);
      const r = await generateImage({ model, prompt, refImageDataUrl: ref });
      updateEntity(activeEntity.id, {
        portrait: {
          mode: 'ai',
          aiSrc: r.dataUrl,
          prompt,
          uploadSrc: activeEntity.portrait?.uploadSrc,
          imageId: activeEntity.portrait?.imageId,
        },
      });
      setAiMsg({ kind: 'ok', text: 'AI 头像已生成并写入该角色 ✓' });
    } catch (e: any) {
      setAiMsg({ kind: 'err', text: e?.message || String(e) });
    } finally {
      setAiBusy(false);
    }
  }

  /** P2-B：AI 文案生成（OpenAI 兼容 chat）。生成背景简介写入实体 materialFields[key]，
   *  即「字段 AI 补全」——模板可用 {customField:key} 绑定展示（决策 #3 的字段按 key 映射）。 */
  async function handleGenText() {
    if (!activeEntity) {
      setAiTextMsg({ kind: 'err', text: '请先在「预览实体」选择角色。' });
      return;
    }
    const model = getCurrentModel();
    if (!model) {
      setAiTextMsg({ kind: 'err', text: '未配置文本模型：请打开 设置 → 大模型接入 添加（endpoint / api_key / model）。' });
      return;
    }
    setAiTextBusy(true);
    setAiTextMsg(null);
    try {
      const e = activeEntity;
      const toneMap: Record<string, string> = {
        formal: '正式、公文、克制', playful: '轻松、俏皮',
        cold: '冷峻、疏离、压抑', absurd: '荒诞、黑色幽默',
      };
      const infoBits: string[] = [];
      if (e.materialFields) {
        for (const [k, v] of Object.entries(e.materialFields)) infoBits.push(`${k}：${v}`);
      }
      if (e.note) infoBits.push(`备注：${e.note}`);
      const prompt =
        `你是世界观视觉物料的文案助手。请为以下角色写一段${toneMap[token.tone.register] ?? '中性'}风格、` +
        `不超过 120 字的中文背景简介，用于「${header}」世界观内的视觉物料。\n角色名：${e.name}\n类别：${e.type}` +
        (infoBits.length ? `\n已知信息：${infoBits.join('；')}` : '') +
        `\n只输出文案正文，不要解释、不要加引号。`;
      const text = (await chatOnce(model, [{ role: 'user', content: prompt }], { feature: 'material-ai' })).trim();
      if (!text) throw new Error('模型返回为空');
      const key = aiFieldKey.trim() || 'ai_bio';
      updateEntity(e.id, { materialFields: { ...(e.materialFields ?? {}), [key]: text } });
      setAiTextMsg({ kind: 'ok', text: `已写入字段「${key}」✓（可在模板用 {customField:${key}} 展示）` });
    } catch (err: any) {
      setAiTextMsg({ kind: 'err', text: '生成失败：' + (err?.message || String(err)) });
    } finally {
      setAiTextBusy(false);
    }
  }

  /** P2-D：AI 字段自动补全。扫描当前模板 source:'ai' 字段，逐个 chatOnce 生成，
   *  写入 aiValues（待审核态）；用户「采用」才落到 entity.materialFields（决策 #3 按 key 映射）。 */
  async function handleCompleteFields() {
    if (!activeTemplate) return;
    const fields = collectAIFields(activeTemplate.blocks);
    if (fields.length === 0) {
      setAiFillMsg({ kind: 'err', text: '当前模板没有声明 AI 生成字段。' });
      return;
    }
    if (!activeEntity) {
      setAiFillMsg({ kind: 'err', text: '请先在「预览实体」选择角色。' });
      return;
    }
    const model = getCurrentModel();
    if (!model) {
      setAiFillMsg({ kind: 'err', text: '未配置文本模型：请打开 设置 → 大模型接入 添加（endpoint / api_key / model）。' });
      return;
    }
    setAiFillBusy(true);
    setAiFillMsg(null);
    const e = activeEntity;
    const toneMap: Record<string, string> = {
      formal: '正式、公文、克制', playful: '轻松、俏皮',
      cold: '冷峻、疏离、压抑', absurd: '荒诞、黑色幽默',
    };
    const infoBits: string[] = [];
    if (e.materialFields) for (const [k, v] of Object.entries(e.materialFields)) infoBits.push(`${k}：${v}`);
    if (e.note) infoBits.push(`备注：${e.note}`);
    try {
      const addProposal = useWorldStore.getState().addProposal;
      let generated = 0;
      for (const f of fields) {
        const prompt =
          `你是世界观视觉物料的文案助手。请为角色「${e.name}」（${e.type}）生成一条「${f.label}」，` +
          `用于世界观内视觉物料。\n要求：${toneMap[token.tone.register] ?? '中性'}风格，中文，不超过 30 字，` +
          `有世界观味道，不解释、不加引号。\n` +
          (infoBits.length ? `已知信息：${infoBits.join('；')}\n` : '') +
          `只输出该条内容本身。`;
        const text = (await chatOnce(model, [{ role: 'user', content: prompt }], { feature: 'material-ai' })).trim();
        if (!text) continue;
        // 写入提案队列（updateEntity 补丁：materialFields 按 key 映射），由用户在「提案中心」采纳
        addProposal({
          source: 'material',
          op: { kind: 'updateEntity', entityId: e.id, patch: { materialFields: { ...(e.materialFields ?? {}), [f.path]: text } } },
          summary: `为「${e.name}」补全物料字段 ${f.path}：${text}`,
        });
        generated += 1;
      }
      if (generated === 0) {
        setAiFillMsg({ kind: 'err', text: '没有生成任何字段，请检查模板 AI 字段或模型返回。' });
      } else {
        setAiFillMsg({ kind: 'ok', text: `已生成 ${generated} 条物料字段提案，请在右上角「提案中心」采纳。` });
      }
    } catch (err: any) {
      setAiFillMsg({ kind: 'err', text: '生成失败：' + (err?.message || String(err)) });
    } finally {
      setAiFillBusy(false);
    }
  }

  return (
    <div className="mf-root">
      <div className="mf-topbar">
        <div className="mf-title">
          <span className="mf-title-main">可视化编辑器</span>
          <span className="mf-title-sub">Visual Editor</span>
        </div>
        <div className="mf-topbar-actions">
          <button className="mode-btn" onClick={() => setShowMarket(true)}>市场 / 库</button>
          <button className="mode-btn" onClick={() => setShowTemplateEditor(true)}>模板编辑器</button>
          <button className="mode-btn" onClick={() => setShowTplGen(true)}>NL 建模板</button>
          <button className="mode-btn" onClick={() => setShowScene(true)}>多模态设卡</button>
          <button className="mode-btn" onClick={() => handleExport('png')} disabled={!activeTemplate}>导出</button>
        </div>
      </div>

      <div className="mf-body">
        {/* 左栏：模板 + 风格 */}
        <aside className="mf-col mf-col-left">
          <div className="mf-section">
            <div className="mf-section-title">模板</div>
            <div className="mf-list">
              {MATERIAL_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  className={'mf-list-item' + (ui.activeTemplateId === t.id ? ' active' : '')}
                  onClick={() => ui.setActiveTemplate(t.id)}
                  title={t.description}
                >
                  <span className="mf-list-name">{t.name}</span>
                  <span className="mf-list-desc">{t.description}</span>
                </button>
              ))}
            </div>
            {userTemplates.length > 0 && (
              <div className="mf-sublist">
                <div className="mf-sublist-title">我的模板</div>
                {userTemplates.map((t) => (
                  <div
                    key={t.id}
                    className={'mf-style-item' + (ui.activeTemplateId === t.id ? ' active' : '')}
                  >
                    <button
                      className="mf-list-item"
                      onClick={() => ui.setActiveTemplate(t.id)}
                      title={t.description}
                    >
                      <span className="mf-list-name">{t.name}</span>
                      <span className="mf-list-desc">{t.description || CATEGORY_LABELS[t.category]}</span>
                    </button>
                    <div className="mf-style-ops">
                      <button className="mf-style-op" title="在编辑器中打开" onClick={() => { ui.setActiveTemplate(t.id); setShowTemplateEditor(true); }}>编辑</button>
                      <button className="mf-style-op mf-style-op-danger" title="删除模板" onClick={() => { if (confirm(`删除模板「${t.name}」？`)) { useWorldStore.getState().deleteTemplate(t.id); if (ui.activeTemplateId === t.id) ui.setActiveTemplate(null); } }}>删除</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mf-section">
            <div className="mf-section-title">风格</div>
            <div className="mf-list">
              <button
                className={'mf-list-item' + (ui.activeStyleId === null ? ' active' : '')}
                onClick={() => ui.setActiveStyle(null)}
              >
                <span className="mf-list-name">默认（自动生成）</span>
                <span className="mf-list-desc">使用内置中性风格令牌</span>
              </button>
              {styles.map((s) => (
                <div
                  key={s.id}
                  className={'mf-style-item' + (ui.activeStyleId === s.id ? ' active' : '')}
                >
                  <button
                    className="mf-list-item"
                    onClick={() => ui.setActiveStyle(s.id)}
                    title={s.description}
                  >
                    <span className="mf-list-name">
                      {s.name}
                      {s.builtin && <span className="mf-builtin-tag">内置</span>}
                    </span>
                    <span className="mf-list-desc">{(s.tags || []).join(' · ') || s.description || ''}</span>
                  </button>
                  <div className="mf-style-ops">
                    <button className="mf-style-op" title="编辑风格" onClick={() => setEditingStyleId(s.id)}>编辑</button>
                    {!s.builtin && (
                      <button
                        className="mf-style-op mf-style-op-danger"
                        title="删除风格"
                        onClick={() => { if (confirm(`删除风格「${s.name}」？此操作不可撤销。`)) { deleteStyle(s.id); if (ui.activeStyleId === s.id) ui.setActiveStyle(null); } }}
                      >删除</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <button
              className="mf-add-style"
              onClick={() => {
                const id = addStyle({
                  name: `新风格 ${styles.length + 1}`,
                  tags: [],
                  description: '',
                  builtin: false,
                  token: createDefaultStyleToken(),
                });
                ui.setActiveStyle(id);
                setEditingStyleId(id);
              }}
            >
              ＋ 新建风格
            </button>
          </div>
        </aside>

        {/* 中栏：预览 */}
        <main className="mf-col mf-col-center">
          {!activeTemplate ? (
            <div className="mf-empty">从左侧选择模板开始生成物料</div>
          ) : (
            <div className="mf-preview-scroll">
              <div ref={previewRef} className="mf-preview-capture-wrap">
                <MaterialPreview
                  token={token}
                  header={header}
                  template={activeTemplate}
                  ctx={ctx}
                  scale={ui.previewScale}
                />
              </div>
            </div>
          )}
        </main>

        {/* 右栏：属性 */}
        <aside className="mf-col mf-col-right">
          <div className="mf-section">
            <div className="mf-section-title">属性</div>

            <div className="mf-field">
              <label>预览实体</label>
              <select value={ui.previewEntityId ?? ''} onChange={(e) => ui.setPreviewEntity(e.target.value || null)}>
                <option value="">— 未选择 —</option>
                {entities.map((e) => (
                  <option key={e.id} value={e.id}>{e.name}（{e.type}）</option>
                ))}
              </select>
            </div>

            <div className="mf-field">
              <label>头像来源</label>
              <div className="mf-seg">
                {(['entity', 'upload', 'ai'] as PortraitMode[]).map((m) => (
                  <button
                    key={m}
                    className={'mf-seg-btn' + (ui.portraitMode === m ? ' active' : '')}
                    onClick={() => ui.setPortraitMode(m)}
                  >
                    {m}
                  </button>
                ))}
              </div>
              {ui.portraitMode === 'ai' && (
                <div style={{ marginTop: 8 }}>
                  <button
                    className="mf-export-btn"
                    style={{ width: '100%' }}
                    onClick={handleGenAvatar}
                    disabled={aiBusy || !activeEntity}
                  >
                    {aiBusy ? '生成中…' : '生成 AI 头像'}
                  </button>
                  {aiMsg && (
                    <div
                      className="mf-ai-msg"
                      style={{ color: aiMsg.kind === 'ok' ? 'var(--accent)' : 'var(--danger)' }}
                    >
                      {aiMsg.text}
                    </div>
                  )}
                  {activeEntity?.portrait?.aiSrc && ui.portraitMode === 'ai' && (
                    <div className="mf-ai-hint">
                      再次点击「生成」将以现有 AI 头像为参考图（refImage 锁）重绘，保持同角色一致。
                    </div>
                  )}
                </div>
              )}
              {ui.portraitMode === 'upload' && (
                <div style={{ marginTop: 8 }}>
                  <label className="mf-export-btn" style={{ width: '100%', display: 'inline-block', textAlign: 'center', cursor: 'pointer' }}>
                    上传头像图片
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (!f || !activeEntity) return;
                        const rd = new FileReader();
                        rd.onload = () => {
                          updateEntity(activeEntity.id, {
                            portrait: {
                              mode: 'upload',
                              uploadSrc: rd.result as string,
                              aiSrc: activeEntity.portrait?.aiSrc,
                              imageId: activeEntity.portrait?.imageId,
                            },
                          });
                          setAiMsg({ kind: 'ok', text: '已上传头像 ✓' });
                        };
                        rd.readAsDataURL(f);
                      }}
                    />
                  </label>
                  {activeEntity?.portrait?.uploadSrc && (
                    <div className="mf-ai-hint">已使用上传的头像；切换回「实体」或「AI」可替换。</div>
                  )}
                </div>
              )}
            </div>

            <div className="mf-field mf-field-row">
              <label>AI 增强</label>
              <input type="checkbox" checked={ui.useAI} onChange={(e) => ui.setUseAI(e.target.checked)} />
            </div>

            <div className="mf-field">
              <label>预览缩放 {Math.round(ui.previewScale * 100)}%</label>
              <input
                type="range"
                min={0.2}
                max={2}
                step={0.05}
                value={ui.previewScale}
                onChange={(e) => ui.setPreviewScale(parseFloat(e.target.value))}
              />
            </div>
          </div>

          <div className="mf-section">
            <div className="mf-section-title">AI 文案</div>
            <div className="mf-field">
              <label>写入字段 key</label>
              <input
                type="text"
                value={aiFieldKey}
                onChange={(e) => setAiFieldKey(e.target.value)}
                placeholder="如 ai_bio（自定义字段，模板可绑定）"
              />
            </div>
            <button
              className="mf-export-btn"
              style={{ width: '100%' }}
              onClick={handleGenText}
              disabled={aiTextBusy || !activeEntity}
            >
              {aiTextBusy ? '生成中…' : 'AI 生成文案并写入字段'}
            </button>
            {aiTextMsg && (
              <div
                className="mf-export-status"
                style={{ color: aiTextMsg.kind === 'ok' ? 'var(--accent)' : 'var(--danger)' }}
              >
                {aiTextMsg.text}
              </div>
            )}
            <div className="mf-ai-hint">
              生成结果写入所选实体的 materialFields[key]（即 customField 按 key 映射）；模板可用 {'{customField:' + (aiFieldKey.trim() || 'ai_bio') + '}'} 绑定展示。
            </div>
          </div>

          <div className="mf-section">
            <div className="mf-section-title">AI 字段补全</div>
            <button
              className="mf-export-btn"
              style={{ width: '100%' }}
              onClick={handleCompleteFields}
              disabled={aiFillBusy || !activeEntity || !activeTemplate}
            >
              {aiFillBusy ? '生成中…' : '扫描模板并 AI 补全字段'}
            </button>
            {aiFillMsg && (
              <div
                className="mf-export-status"
                style={{ color: aiFillMsg.kind === 'ok' ? 'var(--accent)' : 'var(--danger)' }}
              >
                {aiFillMsg.text}
              </div>
            )}
            <div className="mf-ai-hint">
              扫描模板中声明 source:'ai' 的字段并逐个生成；生成结果进入「提案中心」待你采纳后才写入实体（customField 按 key 映射，模板可用 {'{customField:key}'} 绑定展示）。
            </div>
          </div>

          <div className="mf-section">
            <div className="mf-section-title">输出尺寸</div>
            <div className="mf-field">
              <select value={exportPage} onChange={(e) => setExportPage(e.target.value)}>
                {SIZE_PRESETS.map((p) => (
                  <option key={p.key} value={p.key}>{p.label}</option>
                ))}
              </select>
              <div className="mf-ai-hint">
                默认跟随当前风格「{activeStyle?.name ?? '默认（自动生成）'}」：
                {SIZE_PRESETS.find((p) => p.key === (activeStyle?.token.layout.page ?? 'A4'))?.label ?? (activeStyle?.token.layout.page ?? 'A4')}
                {activeTemplate?.pageOverride && '（当前模板已锁定画幅，优先于风格）'}
              </div>
            </div>
          </div>

          <div className="mf-section">
            <div className="mf-section-title">产出</div>
            <button
              className="mf-export-btn mf-export-primary"
              style={{ width: '100%' }}
              onClick={handleExportPreview}
              disabled={!activeTemplate}
            >
              导出当前预览图（所见即所得）
            </button>
            <button
              className="mf-export-btn"
              style={{ width: '100%', marginTop: 8 }}
              onClick={() => handleExport('png')}
              disabled={!activeTemplate}
            >
              导出 PNG（印刷）
            </button>
            <button
              className="mf-export-btn"
              style={{ width: '100%', marginTop: 8 }}
              onClick={() => handleExport('pdf')}
              disabled={!activeTemplate}
            >
              导出 PDF（印刷）
            </button>
            <button
              className="mf-export-btn"
              style={{ width: '100%', marginTop: 8 }}
              onClick={handleCopySocial}
              disabled={!activeTemplate}
            >
              复制图片（社交分享）
            </button>
            <button
              className="mf-export-btn"
              style={{ width: '100%', marginTop: 8 }}
              onClick={handleExportSvg}
              disabled={!activeTemplate}
            >
              导出 SVG（矢量）
            </button>
            <button
              className="mf-export-btn"
              style={{ width: '100%', marginTop: 8 }}
              onClick={() => setShowBatch(true)}
              disabled={entities.length === 0}
            >
              批量生成套系
            </button>
            <button
              className="mf-export-btn"
              style={{ width: '100%', marginTop: 8 }}
              onClick={() => setShowSeries(true)}
              disabled={entities.length === 0}
            >
              套系 / 变量矩阵（P3）
            </button>
            <button
              className="mf-export-btn"
              style={{ width: '100%', marginTop: 8 }}
              onClick={() => setShowConsistency(true)}
            >
              视觉一致性校验
            </button>
            <button
              className="mf-export-btn"
              style={{ width: '100%', marginTop: 8 }}
              onClick={() => setShowGallery(true)}
            >
              物料画廊
            </button>
            {status && <div className="mf-export-status">{status}</div>}
          </div>
        </aside>
      </div>

      {editingStyle && (
        <StyleEditor style={editingStyle} onClose={() => setEditingStyleId(null)} />
      )}

      {showBatch && (
        <BatchPanel
          entities={entities}
          styles={styles}
          worldName={worldName}
          initialTemplateId={ui.activeTemplateId}
          initialStyleId={ui.activeStyleId}
          initialPortraitMode={ui.portraitMode}
          initialUseAI={ui.useAI}
          onClose={() => setShowBatch(false)}
        />
      )}

      {showConsistency && (
        <ConsistencyPanel
          entities={entities}
          styles={styles}
          worldName={worldName}
          initialTemplateId={ui.activeTemplateId}
          initialPortraitMode={ui.portraitMode}
          onClose={() => setShowConsistency(false)}
        />
      )}

      {showSeries && (
        <SeriesPanel
          entities={entities}
          styles={styles}
          worldName={worldName}
          initialTemplateId={ui.activeTemplateId}
          initialStyleId={ui.activeStyleId}
          initialPortraitMode={ui.portraitMode}
          initialUseAI={ui.useAI}
          onClose={() => setShowSeries(false)}
        />
      )}

      {showGallery && <GalleryModal onClose={() => setShowGallery(false)} />}

      {showMarket && <MarketPanel onClose={() => setShowMarket(false)} />}

      {showTplGen && <TemplateGenModal onClose={() => setShowTplGen(false)} />}

      {showScene && <SceneCardModal onClose={() => setShowScene(false)} />}

      {showTemplateEditor && (
        <TemplateEditor
          initialTemplate={ui.activeTemplateId ? getTemplate(ui.activeTemplateId, userTemplates) ?? null : null}
          onClose={() => setShowTemplateEditor(false)}
        />
      )}
    </div>
  );
}
