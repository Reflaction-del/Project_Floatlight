// ============================================================
// 视觉物料生成器 · 风格编辑器（P0-3）
// ------------------------------------------------------------
// 模态弹窗，手动编辑一个 MaterialStyle 的全部 8 维 StyleToken
// （配色 / 字体 / 纹理 / 图标 / Logo / 签名 / 版式 / 语气词典）
// 以及风格元数据（name / tags / description）。
// 用户在本地 draft 上编辑，点「保存」才提交 worldStore.updateStyle；
// 非内置风格可「删除」（worldStore.deleteStyle）。
// 右侧实时迷你预览，随 draft 变化联动（含纹理 / Logo 叠层）。
// ============================================================

import { useState, useEffect } from 'react';
import { useWorldStore } from '../../store/worldStore';
import type { MaterialStyle, StyleToken, TextureToken, ToneWord,
  TextureKey, PageKind, ToneRegister, PaletteToken, SignatureToken,
} from './types';
import { MaterialPreview } from './Preview';
import { getTemplate } from './templates/registry';
import type { RenderContext } from './bindings';
import type { WikiEntity, EntityField } from '../../types';
import { applyStyleIntent } from './styleIntent';
import { inferStyleFromImage } from './styleInfer';
import { buildLogoPrompt } from './aiPrompt';
import { getCurrentModel, generateImage } from '../../utils/ai';

/* ---------- 通用小工具 ---------- */
function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

type Opt = { v: string; l: string };
type LogoShape = 'circle' | 'ellipse' | 'square' | 'rect' | 'line';

/* ---------- 字段控件 ---------- */
function TextField({ label, value, onChange, placeholder, area }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; area?: boolean;
}) {
  return (
    <label className="mf-text-cell">
      <span className="mf-fld-label">{label}</span>
      {area
        ? <textarea value={value} placeholder={placeholder} rows={3} onChange={(e) => onChange(e.target.value)} />
        : <input type="text" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />}
    </label>
  );
}

function NumField({ label, value, onChange, min, max, step }: {
  label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number;
}) {
  return (
    <label className="mf-num-cell">
      <span className="mf-fld-label">{label}</span>
      <input type="number" value={value} min={min} max={max} step={step}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)} />
    </label>
  );
}

function SelectField({ label, value, options, onChange }: {
  label: string; value: string; options: Opt[]; onChange: (v: string) => void;
}) {
  return (
    <label className="mf-sel-cell">
      <span className="mf-fld-label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </label>
  );
}

function ColorField({ label, value, onChange }: {
  label: string; value: string; onChange: (v: string) => void;
}) {
  return (
    <label className="mf-color-cell" title={value}>
      <span className="mf-color-swatch" style={{ background: value || '#000' }} />
      <span className="mf-color-label">{label}</span>
      <input type="color" value={value || '#000000'} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/* ---------- 字体字段：系统字体 + 自定义输入 ---------- */
function FontField({ label, value, onChange, systemFonts }: {
  label: string; value: string; onChange: (v: string) => void; systemFonts: string[];
}) {
  const candidates = [...new Set([...FONT_OPTIONS, ...systemFonts])];
  const matched = candidates.includes(value);
  return (
    <label className="mf-text-cell">
      <span className="mf-fld-label">{label}</span>
      <input
        type="text"
        value={value}
        placeholder="输入 font-family 或从下方选择"
        onChange={(e) => onChange(e.target.value)}
      />
      <select
        className="mf-font-select"
        value={matched ? value : ''}
        onChange={(e) => { if (e.target.value) onChange(e.target.value); }}
      >
        <option value="">-- 从系统字体选择 --</option>
        {systemFonts.length > 0 && (
          <optgroup label="系统字体">
            {systemFonts.map((f) => <option key={f} value={f}>{f}</option>)}
          </optgroup>
        )}
        <optgroup label="常用字体">
          {FONT_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
        </optgroup>
      </select>
    </label>
  );
}

function Section({ title, n, children }: { title: string; n: string; children: React.ReactNode }) {
  return (
    <div className="mf-sec">
      <div className="mf-sec-title"><span className="mf-sec-n">{n}</span>{title}</div>
      <div className="mf-sec-body">{children}</div>
    </div>
  );
}

/* ---------- 纹理 / Logo 预览叠层 ---------- */
function textureCss(t: TextureToken): React.CSSProperties {
  const op = t.opacity;
  const blend = t.blend as React.CSSProperties['mixBlendMode'];
  switch (t.key) {
    case 'grid':
      return { backgroundImage: 'linear-gradient(rgba(0,0,0,.28) 1px,transparent 1px),linear-gradient(90deg,rgba(0,0,0,.28) 1px,transparent 1px)', backgroundSize: '12px 12px', opacity: op, mixBlendMode: blend };
    case 'dots':
      return { backgroundImage: 'radial-gradient(rgba(0,0,0,.32) 1.4px,transparent 1.6px)', backgroundSize: '10px 10px', opacity: op, mixBlendMode: blend };
    case 'lined':
      return { backgroundImage: 'repeating-linear-gradient(transparent,transparent 5px,rgba(0,0,0,.18) 5px,rgba(0,0,0,.18) 6px)', opacity: op, mixBlendMode: blend };
    case 'scanline':
      return { backgroundImage: 'repeating-linear-gradient(transparent,transparent 2px,rgba(0,0,0,.22) 2px,rgba(0,0,0,.22) 3px)', opacity: op, mixBlendMode: blend };
    case 'noise':
      return { backgroundImage: 'repeating-conic-gradient(rgba(0,0,0,.10) 0% 25%,transparent 0% 50%)', backgroundSize: '4px 4px', opacity: op, mixBlendMode: blend };
    case 'stamp':
      return { backgroundImage: 'radial-gradient(circle at 50% 50%, rgba(0,0,0,.18), transparent 62%)', backgroundSize: '18px 18px', opacity: op, mixBlendMode: blend };
    case 'paper':
      return { backgroundImage: 'linear-gradient(135deg, rgba(0,0,0,.05), rgba(255,255,255,.05))', opacity: op, mixBlendMode: blend };
    default:
      return {};
  }
}

function LogoPreview({ src, shape, size }: { src: string; shape: string; size: number }) {
  const isSvg = src.trim().startsWith('<svg') || src.includes('<svg');
  const radius = shape === 'circle' || shape === 'ellipse' ? '50%' : shape === 'line' ? '0' : '6px';
  return (
    <div className="mf-mini-logo" style={{ width: size, height: size, borderRadius: radius }}>
      {isSvg
        ? <div dangerouslySetInnerHTML={{ __html: src }} style={{ width: '100%', height: '100%' }} />
        : <img src={src} alt="logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />}
    </div>
  );
}

/* ---------- 实时预览：用完整模板（staffFile）渲染 Demo 实体 ---------- */
const DEMO_TEMPLATE_ID = 'staffFile';

const DEMO_ENTITY: WikiEntity = {
  id: 'demo-entity-style-preview',
  type: 'character',
  name: '角色档案样例',
  fields: [
    { label: '描述', value: '一名用于预览风格令牌效果的虚构角色。' } as EntityField,
  ],
  custom: [],
  tags: ['preview'],
  materialFields: {
    serial: 'SUBJ-0001',
    id: 'ID-000000',
    ai_bio: '这是用于预览风格的一段示例传记。它应随纸张底色、正文字体、纹理叠加、语气词典而变化。',
    signature: '档案官',
  },
  spectrumColor: '#3aa0ff',
  createdAt: 1,
  updatedAt: 1,
};

function StylePreview({ token, name, scale }: { token: StyleToken; name: string; scale: number }) {
  const template = getTemplate(DEMO_TEMPLATE_ID, undefined);
  if (!template) return <div className="mf-hint">模板 {DEMO_TEMPLATE_ID} 未找到</div>;
  const header = token.layout.header ?? name;
  const ctx: RenderContext = {
    entity: DEMO_ENTITY,
    worldName: name,
    token,
    portraitMode: 'entity',
    useAI: false,
    allEntities: [DEMO_ENTITY],
    aiValues: {
      ai_quote: '“秩序即真理，编号即姓名。”',
    },
  };
  return (
    <div className="mf-style-preview-wrap">
      <MaterialPreview token={token} header={header} template={template} ctx={ctx} scale={scale} />
    </div>
  );
}

/* ---------- 常量选项 ---------- */
const FONT_OPTIONS = [
  '"Noto Serif SC", "Songti SC", serif',
  '"Noto Sans SC", "PingFang SC", sans-serif',
  '"JetBrains Mono", "Courier New", monospace',
  '"Caveat", cursive',
  '"Ma Shan Zheng", cursive',
  'Georgia, serif',
  '"Times New Roman", serif',
  'Arial, sans-serif',
  'monospace',
];
const TEXTURE_OPTIONS: Opt[] = [
  { v: 'none', l: '无' }, { v: 'grid', l: '网格' }, { v: 'paper', l: '纸纹' },
  { v: 'scanline', l: '扫描线' }, { v: 'noise', l: '噪点' }, { v: 'dots', l: '点阵' },
  { v: 'lined', l: '横线' }, { v: 'stamp', l: '印章纹' },
];
const BLEND_OPTIONS: Opt[] = [
  { v: 'normal', l: '正常' }, { v: 'multiply', l: '正片叠底' }, { v: 'overlay', l: '叠加' },
];
const PAGE_OPTIONS: Opt[] = [
  { v: 'A4', l: 'A4 纵向' }, { v: 'A5', l: 'A5' }, { v: 'A6', l: 'A6' },
  { v: 'square', l: '方形' }, { v: 'id_card', l: '证件卡' }, { v: 'poster', l: '海报' }, { v: 'custom', l: '自定义' },
];
const SHAPE_OPTIONS: Opt[] = [
  { v: 'circle', l: '圆形' }, { v: 'ellipse', l: '椭圆' }, { v: 'square', l: '方形' },
  { v: 'rect', l: '圆角矩形' }, { v: 'line', l: '水平条' },
];
const REGISTER_OPTIONS: Opt[] = [
  { v: 'formal', l: '正式 / 公文' }, { v: 'playful', l: '俏皮' },
  { v: 'cold', l: '冷峻 / 克制' }, { v: 'absurd', l: '荒诞 / 黑色幽默' },
];

/* ---------- 主组件 ---------- */
export function StyleEditor({ style, onClose }: { style: MaterialStyle; onClose: () => void }) {
  const updateStyle = useWorldStore((s) => s.updateStyle);
  const deleteStyle = useWorldStore((s) => s.deleteStyle);

  const [draft, setDraft] = useState(() => ({
    name: style.name,
    tagsText: (style.tags || []).join('，'),
    description: style.description ?? '',
    token: clone(style.token),
  }));
  const [confirmDel, setConfirmDel] = useState(false);
  // 实时预览缩放
  const [previewZoom, setPreviewZoom] = useState(0.6);
  // P2-C：自然语言改风格
  const [intent, setIntent] = useState('');
  const [intentMsg, setIntentMsg] = useState<string | null>(null);
  // P2-E：风格反推（参考图 → 配色）
  const [inferMsg, setInferMsg] = useState<string | null>(null);
  // P2-F：AI 生成 Logo
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoMsg, setLogoMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  // 系统字体列表
  const [systemFonts, setSystemFonts] = useState<string[]>([]);
  useEffect(() => {
    (async () => {
      try {
        const raw = await window.api?.listFonts?.();
        if (!raw) return;
        const cleaned = raw
          .map((name) => name.replace(/\s*\([^)]+\)\s*$/, '').trim())
          .filter(Boolean);
        setSystemFonts([...new Set(cleaned)]);
      } catch { /* 主进程未暴露或调用失败时不影响编辑 */ }
    })();
  }, []);

  const patchToken = (mut: (t: StyleToken) => void) =>
    setDraft((d) => {
      const nt = clone(d.token);
      mut(nt);
      return { ...d, token: nt };
    });

  const save = () => {
    const tags = draft.tagsText.split(/[,，、\s]+/).map((s) => s.trim()).filter(Boolean);
    updateStyle(style.id, {
      name: draft.name.trim() || style.name,
      tags,
      description: draft.description,
      token: draft.token,
    });
    onClose();
  };

  const remove = () => {
    deleteStyle(style.id);
    onClose();
  };

  // P2-C：自然语言指令 → 局部修改 draft.token（点保存才提交）
  const applyIntent = () => {
    if (!intent.trim()) return;
    const { token: nt, applied } = applyStyleIntent(intent, draft.token);
    setDraft((d) => ({ ...d, token: nt }));
    setIntentMsg(
      applied.length
        ? `已应用：${applied.join('，')}（点保存生效）`
        : '未识别到可调整的指令，请换种说法（如：主色改成深蓝，标题用衬线，纹理网格，语气正式）。',
    );
  };

  // P2-E：参考图反推配色（离线 canvas 提取主色板）
  const handleInfer = (file: File) => {
    const rd = new FileReader();
    rd.onload = async () => {
      try {
        const dataUrl = rd.result as string;
        const { palette, applied } = await inferStyleFromImage(dataUrl);
        patchToken((x) => { x.palette = { ...x.palette, ...palette } as PaletteToken; });
        setInferMsg(`已反推：${applied.join('，')}（点保存生效）`);
      } catch (e: any) {
        setInferMsg('反推失败：' + (e?.message || String(e)));
      }
    };
    rd.onerror = () => setInferMsg('图片读取失败');
    rd.readAsDataURL(file);
  };

  // P2-F：AI 生成 Logo（复用 ai.generateImage）
  const handleGenLogo = async () => {
    const model = getCurrentModel();
    if (!model) {
      setLogoMsg({ kind: 'err', text: '未配置文生图模型：请打开 设置 → 大模型接入 添加（endpoint / api_key / model）。' });
      return;
    }
    setLogoBusy(true);
    setLogoMsg(null);
    try {
      const prompt = buildLogoPrompt(draft.token, draft.name);
      const r = await generateImage({ model, prompt, size: '256x256' });
      patchToken((x) => { x.logo.src = r.dataUrl; });
      setLogoMsg({ kind: 'ok', text: 'AI Logo 已生成 ✓（点保存生效）' });
    } catch (e: any) {
      setLogoMsg({ kind: 'err', text: e?.message || String(e) });
    } finally {
      setLogoBusy(false);
    }
  };

  const t = draft.token;

  // 从系统文件选择器上传图片（Logo / 印章）
  const pickImage = async (): Promise<string | null> => {
    try {
      return (await window.api?.openImage?.()) ?? null;
    } catch (e: any) {
      return null;
    }
  };

  return (
    <div className="mf-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mf-modal">
        <div className="mf-modal-head">
          <div>
            <div className="mf-modal-title">编辑风格 · {style.name}</div>
            <div className="mf-modal-sub">{style.builtin ? '内置预设（不可删除）' : '用户风格'}</div>
          </div>
          <button className="mf-x" onClick={onClose} title="关闭">×</button>
        </div>

        <div className="mf-modal-body">
          <div className="mf-modal-form">
            <Section title="基础信息" n="①">
              <TextField label="名称" value={draft.name} onChange={(v) => setDraft((d) => ({ ...d, name: v }))} placeholder="如：HRI 临床档案" />
              <TextField label="标签（逗号分隔，用于检索/推荐）" value={draft.tagsText}
                onChange={(v) => setDraft((d) => ({ ...d, tagsText: v }))} placeholder="机构，黑白，官僚" />
              <TextField label="描述" value={draft.description} area
                onChange={(v) => setDraft((d) => ({ ...d, description: v }))} placeholder="一句话说明这套风格的用途" />
            </Section>

            <Section title="配色" n="②">
              <div className="mf-color-grid">
                <ColorField label="纸张底色" value={t.palette.paper} onChange={(v) => patchToken((x) => { x.palette.paper = v; })} />
                <ColorField label="主文字色" value={t.palette.ink} onChange={(v) => patchToken((x) => { x.palette.ink = v; })} />
                <ColorField label="机构主色" value={t.palette.accent} onChange={(v) => patchToken((x) => { x.palette.accent = v; })} />
                <ColorField label="次要文字" value={t.palette.muted} onChange={(v) => patchToken((x) => { x.palette.muted = v; })} />
                <ColorField label="警示 / 危险" value={t.palette.danger} onChange={(v) => patchToken((x) => { x.palette.danger = v; })} />
                <ColorField label="提示 / 注意" value={t.palette.warn} onChange={(v) => patchToken((x) => { x.palette.warn = v; })} />
                <ColorField label="条形码色" value={t.palette.barcode ?? '#222222'} onChange={(v) => patchToken((x) => { x.palette.barcode = v; })} />
              </div>
            </Section>

            <Section title="从参考图反推配色" n="⑪">
              <label className="mf-export-btn" style={{ width: '100%', display: 'inline-block', textAlign: 'center', cursor: 'pointer' }}>
                上传参考图反推配色
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleInfer(f); }}
                />
              </label>
              {inferMsg && <div className="mf-hint">{inferMsg}</div>}
              <div className="mf-hint">离线提取参考图主色，自动填入纸张 / 墨色 / 主色 / 次要；点「保存」生效。</div>
            </Section>

            <Section title="字体与字号" n="③">
              <FontField label="标题字体" value={t.typography.titleFont} systemFonts={systemFonts}
                onChange={(v) => patchToken((x) => { x.typography.titleFont = v; })} />
              <FontField label="正文字体" value={t.typography.bodyFont} systemFonts={systemFonts}
                onChange={(v) => patchToken((x) => { x.typography.bodyFont = v; })} />
              <FontField label="等宽 / 编号字体" value={t.typography.monoFont} systemFonts={systemFonts}
                onChange={(v) => patchToken((x) => { x.typography.monoFont = v; })} />
              <div className="mf-num-row">
                <NumField label="标题字号(px)" value={t.typography.titleSize} min={8} max={64} step={1}
                  onChange={(v) => patchToken((x) => { x.typography.titleSize = v; })} />
                <NumField label="正文字号(px)" value={t.typography.bodySize} min={8} max={32} step={1}
                  onChange={(v) => patchToken((x) => { x.typography.bodySize = v; })} />
                <NumField label="标签字号(px)" value={t.typography.labelSize} min={8} max={24} step={1}
                  onChange={(v) => patchToken((x) => { x.typography.labelSize = v; })} />
              </div>
            </Section>

            <Section title="纸张纹理" n="④">
              <SelectField label="纹理类型" value={t.texture.key} options={TEXTURE_OPTIONS}
                onChange={(v) => patchToken((x) => { x.texture.key = v as TextureKey; })} />
              <div className="mf-num-row">
                <NumField label="不透明度(0-1)" value={t.texture.opacity} min={0} max={1} step={0.02}
                  onChange={(v) => patchToken((x) => { x.texture.opacity = v; })} />
                <SelectField label="混合模式" value={t.texture.blend} options={BLEND_OPTIONS}
                  onChange={(v) => patchToken((x) => { x.texture.blend = v as TextureToken['blend']; })} />
              </div>
            </Section>

            <Section title="图标库" n="⑤">
              <TextField label="图标集名称（key）" value={t.icon.set}
                onChange={(v) => patchToken((x) => { x.icon.set = v; })} placeholder="如：hri-skull / line / pixel" />
              <div className="mf-hint">已登记图标资源 {t.icon.assets.length} 个（图标资产上传将在 P2 接入）。</div>
            </Section>

            <Section title="主 Logo" n="⑥">
              <TextField label="Logo 源（inline SVG 文本 或 dataURL）" value={t.logo.src} area
                onChange={(v) => patchToken((x) => { x.logo.src = v; })} placeholder="<svg ...>...</svg> 或 data:image/..." />
              <div className="mf-logo-preview-row">
                {t.logo.src && <LogoPreview src={t.logo.src} shape={t.logo.shape} size={t.logo.size} />}
                <button
                  className="mf-btn-ghost"
                  onClick={async () => { const url = await pickImage(); if (url) patchToken((x) => { x.logo.src = url; }); }}
                >
                  从本地上传 Logo
                </button>
              </div>
              <div className="mf-num-row">
                <SelectField label="形状" value={t.logo.shape} options={SHAPE_OPTIONS}
                  onChange={(v) => patchToken((x) => { x.logo.shape = v as LogoShape; })} />
                <NumField label="尺寸(px)" value={t.logo.size} min={16} max={160} step={2}
                  onChange={(v) => patchToken((x) => { x.logo.size = v; })} />
              </div>
              <button
                className="mf-export-btn"
                style={{ width: '100%', marginTop: 8 }}
                onClick={handleGenLogo}
                disabled={logoBusy}
              >
                {logoBusy ? '生成中…' : 'AI 生成 Logo'}
              </button>
              {logoMsg && (
                <div className="mf-hint" style={{ color: logoMsg.kind === 'ok' ? 'var(--accent)' : 'var(--danger)' }}>
                  {logoMsg.text}
                </div>
              )}
            </Section>

            <Section title="签名 / 印章" n="⑦">
              <SelectField label="渲染模式" value={t.signature.mode || 'auto'}
                options={[
                  { v: 'auto', l: '自动（有图片则显示图片，否则文字）' },
                  { v: 'text', l: '仅文字签名' },
                  { v: 'image', l: '仅印章图片' },
                ]}
                onChange={(v) => patchToken((x) => { x.signature.mode = v as SignatureToken['mode']; })}
              />
              <FontField label="签名字体" value={t.signature.font} systemFonts={systemFonts}
                onChange={(v) => patchToken((x) => { x.signature.font = v; })} />
              <div className="mf-num-row">
                <ColorField label="颜色" value={t.signature.color} onChange={(v) => patchToken((x) => { x.signature.color = v; })} />
                <label className="mf-check-cell">
                  <input type="checkbox" checked={t.signature.italic}
                    onChange={(e) => patchToken((x) => { x.signature.italic = e.target.checked; })} />
                  <span>斜体</span>
                </label>
              </div>
              <TextField label="印章图片源（dataURL 或 SVG）" value={t.signature.imageSrc ?? ''} area
                onChange={(v) => patchToken((x) => { x.signature.imageSrc = v; })}
                placeholder="data:image/... 或 <svg>..." />
              <div className="mf-sign-preview-row">
                {t.signature.imageSrc && (
                  t.signature.imageSrc.trim().startsWith('<svg')
                    ? <div dangerouslySetInnerHTML={{ __html: t.signature.imageSrc }} style={{ height: t.signature.imageHeight ?? 40 }} />
                    : <img src={t.signature.imageSrc} alt="印章" style={{ height: t.signature.imageHeight ?? 40, objectFit: 'contain' }} />
                )}
                <button className="mf-btn-ghost"
                  onClick={async () => { const url = await pickImage(); if (url) patchToken((x) => { x.signature.imageSrc = url; }); }}>
                  从本地上传印章 / 签名
                </button>
              </div>
              <NumField label="印章图片高度(px)" value={t.signature.imageHeight ?? 40} min={12} max={120} step={2}
                onChange={(v) => patchToken((x) => { x.signature.imageHeight = v; })} />
            </Section>

            <Section title="版式" n="⑧">
              <SelectField label="画幅" value={t.layout.page} options={PAGE_OPTIONS}
                onChange={(v) => patchToken((x) => { x.layout.page = v as PageKind; })} />
              <div className="mf-num-row">
                <NumField label="宽(mm)" value={t.layout.widthMm} min={20} max={1000} step={1}
                  onChange={(v) => patchToken((x) => { x.layout.widthMm = v; })} />
                <NumField label="高(mm)" value={t.layout.heightMm} min={20} max={2000} step={1}
                  onChange={(v) => patchToken((x) => { x.layout.heightMm = v; })} />
                <NumField label="页边距(mm)" value={t.layout.marginMm} min={0} max={60} step={1}
                  onChange={(v) => patchToken((x) => { x.layout.marginMm = v; })} />
                <NumField label="内边距(mm)" value={t.layout.paddingMm} min={0} max={60} step={1}
                  onChange={(v) => patchToken((x) => { x.layout.paddingMm = v; })} />
              </div>
              <TextField label="页眉模板（支持 {worldName}）" value={t.layout.header ?? ''}
                onChange={(v) => patchToken((x) => { x.layout.header = v; })} placeholder="{worldName}" />
              <TextField label="页脚模板" value={t.layout.footer ?? ''}
                onChange={(v) => patchToken((x) => { x.layout.footer = v; })} placeholder="CONFIDENTIAL" />
              <TextField label="水印文案" value={t.layout.watermark ?? ''}
                onChange={(v) => patchToken((x) => { x.layout.watermark = v; })} placeholder="留空则不显示" />
            </Section>

            <Section title="语气词典" n="⑨">
              <SelectField label="语气基调" value={t.tone.register} options={REGISTER_OPTIONS}
                onChange={(v) => patchToken((x) => { x.tone.register = v as ToneRegister; })} />
              <div className="mf-dict">
                {t.tone.dictionary.map((w, i) => (
                  <div className="mf-dict-row" key={i}>
                    <input placeholder="通用占位词" value={w.from}
                      onChange={(e) => patchToken((x) => { x.tone.dictionary[i] = { ...x.tone.dictionary[i], from: e.target.value } as ToneWord; })} />
                    <span className="mf-dict-arrow">→</span>
                    <input placeholder="世界观内术语" value={w.to}
                      onChange={(e) => patchToken((x) => { x.tone.dictionary[i] = { ...x.tone.dictionary[i], to: e.target.value } as ToneWord; })} />
                    <button className="mf-dict-del" title="删除该词典项"
                      onClick={() => patchToken((x) => { x.tone.dictionary.splice(i, 1); })}>×</button>
                  </div>
                ))}
                <button className="mf-dict-add"
                  onClick={() => patchToken((x) => { x.tone.dictionary.push({ from: '', to: '' }); })}>
                  ＋ 添加词典项
                </button>
              </div>
              <div className="mf-hint">渲染时，通用模板里的占位术语会被替换成世界观专属词（如「实验体」→「Subject」）。</div>
            </Section>

            <Section title="自然语言改风格" n="⑩">
              <div className="mf-nl-box">
                <textarea
                  value={intent}
                  placeholder="例如：主色改成深蓝，标题用衬线字体，纹理用网格，语气正式，画幅 A4"
                  rows={3}
                  onChange={(e) => setIntent(e.target.value)}
                />
                <button className="mf-nl-apply" onClick={applyIntent} disabled={!intent.trim()}>
                  应用调整
                </button>
              </div>
              {intentMsg && <div className="mf-hint">{intentMsg}</div>}
              <div className="mf-hint">
                支持：主色/纸张/文字/次要/警示/提示 配色（十六进制或「深蓝/红/绿」等色名）；标题/正文/编号 字体；纹理；语气；画幅。
              </div>
            </Section>
          </div>

          <div className="mf-modal-preview">
            <div className="mf-preview-label">实时预览</div>
            <div className="mf-preview-zoom-bar">
              <button
                className="mf-zoom-btn"
                onClick={() => setPreviewZoom((z) => Math.max(0.3, +(z - 0.05).toFixed(2)))}
                title="缩小"
              >−</button>
              <input
                type="range"
                min={0.3}
                max={1.5}
                step={0.05}
                value={previewZoom}
                onChange={(e) => setPreviewZoom(+(e.target.value))}
                aria-label="预览缩放"
              />
              <button
                className="mf-zoom-btn"
                onClick={() => setPreviewZoom((z) => Math.min(1.5, +(z + 0.05).toFixed(2)))}
                title="放大"
              >＋</button>
              <span className="mf-zoom-value">{Math.round(previewZoom * 100)}%</span>
            </div>
            <StylePreview token={t} name={draft.name} scale={previewZoom} />
            <div className="mf-modal-actions">
              {!style.builtin && (
                confirmDel ? (
                  <span className="mf-confirm">
                    <span>确认删除？</span>
                    <button className="mf-btn-danger" onClick={remove}>删除</button>
                    <button className="mf-btn-ghost" onClick={() => setConfirmDel(false)}>取消</button>
                  </span>
                ) : (
                  <button className="mf-btn-danger-outline" onClick={() => setConfirmDel(true)}>删除风格</button>
                )
              )}
              <button className="mf-btn-ghost" onClick={onClose}>取消</button>
              <button className="mf-btn-primary" onClick={save}>保存</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
