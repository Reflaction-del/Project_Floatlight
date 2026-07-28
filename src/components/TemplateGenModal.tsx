// ============================================================
// 自然语言创建物料模板弹窗（Phase 3 · 功能5）
// ------------------------------------------------------------
// 用户输入自然语言描述 → 调文本模型生成 MaterialTemplate → 可改名称/类别
// → 实时预览（用示例实体渲染）→ 加入提案队列（source:'template-gen'）。
// ============================================================

import { useRef, useState } from 'react';
import { useWorldStore } from '../store/worldStore';
import { useUIStore } from '../store/uiStore';
import { useWorldviewStore } from '../store/worldviewStore';
import type { WikiEntity, EntityType } from '../types';
import { generateTemplate } from '../features/ai/templateGen';
import { MaterialPreview } from '../features/materials/Preview';
import { createDefaultStyleToken } from '../features/materials/types';
import type { MaterialTemplate, StyleToken, TemplateCategory } from '../features/materials/types';
import { CATEGORY_LABELS, SIZE_PRESETS } from '../features/materials/types';
import type { RenderContext } from '../features/materials/bindings';

const CATEGORIES: TemplateCategory[] = ['personnel', 'identity', 'daily', 'intel', 'technical', 'narrative'];

// 预览用示例实体，使模板中的 {field:*} / {customField:*} 占位符有值可渲染
const SAMPLE_ENTITY: WikiEntity = {
  id: '__tpl_sample__',
  type: 'character',
  name: '示例·夜枭',
  fields: [],
  custom: [],
  tags: [],
  note: '示例实体',
  materialFields: {
    id: 'ID-2024-007',
    signature: '以影为刃',
    阵营: '夜枭议会',
    身份: '首席潜行者',
    性格: '冷峻',
    能力: '影步',
    悬赏: '500,000',
    罪名: '窃取圣物',
    简介: '活跃于旧城区的影子，来历成谜。',
  },
  portrait: { mode: 'upload', uploadSrc: '' },
  images: [],
  createdAt: 0,
  updatedAt: 0,
};

function previewScale(tpl: MaterialTemplate): number {
  const preset = SIZE_PRESETS.find((p) => p.key === tpl.pageOverride);
  const pagePxW = preset ? Math.round(preset.w * 96 / 25.4) : 793;
  const s = 380 / pagePxW;
  return Math.max(0.3, Math.min(1.6, s));
}

export function TemplateGenModal({ onClose }: { onClose: () => void }) {
  const worldview = useWorldviewStore();
  const worldName = worldview.worlds.find((w) => w.name === worldview.current)?.name ?? '世界观';
  const addProposal = useWorldStore.getState().addProposal;
  const setProposals = useUIStore((s) => s.setProposals);

  const [prompt, setPrompt] = useState('');
  const [category, setCategory] = useState<TemplateCategory | ''>('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [tpl, setTpl] = useState<MaterialTemplate | null>(null);
  const [editName, setEditName] = useState('');
  const [editCategory, setEditCategory] = useState<TemplateCategory>('identity');

  const abortRef = useRef<AbortController | null>(null);

  async function runGen() {
    if (!prompt.trim()) {
      setError('请先描述你想要的模板（如：赛博朋克风格的角色通缉令，含照片、悬赏金额、罪名、签名）。');
      return;
    }
    setBusy(true);
    setError(null);
    setTpl(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const r = await generateTemplate(prompt.trim(), worldName, { category: category || undefined }, ctrl.signal);
      setTpl(r);
      setEditName(r.name);
      setEditCategory(r.category);
    } catch (err: any) {
      if (ctrl.signal.aborted) return;
      setError('生成失败：' + (err?.message || String(err)));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  function cancelGen() {
    abortRef.current?.abort();
    setBusy(false);
  }

  function toProposal() {
    if (!tpl) return;
    const finalTpl: MaterialTemplate = { ...tpl, name: editName.trim() || tpl.name, category: editCategory };
    addProposal({
      source: 'template-gen',
      op: { kind: 'addTemplate', template: finalTpl },
      summary: `生成物料模板：${finalTpl.name}（${CATEGORY_LABELS[finalTpl.category]}）`,
    });
    setProposals(true);
    onClose();
  }

  const token: StyleToken = createDefaultStyleToken();
  const ctx: RenderContext = {
    entity: SAMPLE_ENTITY,
    worldName,
    token,
    portraitMode: 'upload',
    useAI: false,
    allEntities: [],
    aiValues: {},
  };

  return (
    <div className="modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal tplgen-modal">
        <div className="modal-head">
          <span>自然语言创建物料模板</span>
          <button className="modal-x" onClick={onClose}>✕</button>
        </div>

        <div className="tplgen-body">
          <div className="tplgen-left">
            <div className="scene-field">
              <label>用自然语言描述你想要的模板</label>
              <textarea
                className="tplgen-text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={5}
                placeholder={'例如：一张赛博朋克风格的角色通缉令，顶部是机构名，中间是照片、姓名、悬赏金额和罪名，底部是签发人签名和条形码。'}
              />
            </div>
            <div className="scene-field scene-field-row">
              <div className="scene-col">
                <label>类别（可选，留空自动推断）</label>
                <select value={category} onChange={(e) => setCategory(e.target.value as TemplateCategory | '')}>
                  <option value="">自动推断</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                  ))}
                </select>
              </div>
              <button className="mf-export-btn scene-run" onClick={busy ? cancelGen : runGen}>
                {busy ? '停止' : '生成模板'}
              </button>
            </div>
            {error && <div className="scene-error">{error}</div>}

            {tpl && (
              <div className="tplgen-edit">
                <div className="scene-field scene-field-row">
                  <div className="scene-col">
                    <label>模板名称</label>
                    <input value={editName} onChange={(e) => setEditName(e.target.value)} />
                  </div>
                  <div className="scene-col scene-col-sm">
                    <label>类别</label>
                    <select value={editCategory} onChange={(e) => setEditCategory(e.target.value as TemplateCategory)}>
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="tplgen-meta">共 {tpl.blocks.length} 个块 · 版式 {tpl.pageOverride} · 生成后可在「可视化编辑器」直接用</div>
                <button className="mf-export-btn mf-export-primary scene-submit" onClick={toProposal}>
                  加入提案队列（待你采纳）
                </button>
              </div>
            )}
          </div>

          <div className="tplgen-right">
            <div className="scene-preview-title">实时预览（示例实体）</div>
            <div className="scene-preview-scroll">
              {tpl ? (
                <MaterialPreview
                  token={token}
                  header={worldName}
                  template={tpl}
                  ctx={ctx}
                  scale={previewScale(tpl)}
                />
              ) : (
                <div className="scene-preview-empty">
                  {busy ? '正在生成模板…' : '描述并点击「生成模板」后，在此预览效果'}
                </div>
              )}
            </div>
            <div className="scene-preview-note">
              预览用内置示例实体渲染，仅用于检查版式；采纳后该模板会以你世界中真实实体套用。
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
