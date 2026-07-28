// ============================================================
// 视觉物料生成器 · 可视化模板编辑器（P3-C）
// ------------------------------------------------------------
// 拖拽式（增删 / 上移下移 / 树形展开）Block 编辑 + 右栏属性面板
// + JSON 模式（与 registry 互通）。编辑内置模板时复制为独立用户
// 模板，保存进 worldStore.templates，不污染内置 registry。
// ============================================================

import { useMemo, useRef, useState } from 'react';
import { useWorldStore } from '../../store/worldStore';
import { useWorldviewStore } from '../../store/worldviewStore';
import { useMaterialStore } from './store';
import { createDefaultStyleToken, CATEGORY_LABELS, CHART_KIND_LABELS } from './types';
import { MaterialPreview } from './Preview';
import type {
  Block, BlockType, MaterialTemplate, FieldBinding, BindingSource,
  TemplateCategory, GroupBlock, RepeatBlock, TemplateBackground, ChartKind,
  SpectrumColorMode, SpectrumColorRule,
} from './types';
import type { WikiEntity } from '../../types';
import type { RenderContext } from './bindings';

/* ---------- 块树递归工具（纯函数，不可变更新） ---------- */
function findInTree(blocks: Block[], id: string): Block | null {
  for (const b of blocks) {
    if (b.id === id) return b;
    if (b.type === 'group') { const r = findInTree((b as GroupBlock).blocks, id); if (r) return r; }
    if (b.type === 'repeat') { const r = findInTree((b as RepeatBlock).itemTemplate, id); if (r) return r; }
  }
  return null;
}
function updateInTree(blocks: Block[], id: string, patch: Partial<Block>): Block[] {
  return blocks.map((b) => {
    if (b.id === id) return { ...b, ...patch } as Block;
    if (b.type === 'group') return { ...b, blocks: updateInTree((b as GroupBlock).blocks, id, patch) } as Block;
    if (b.type === 'repeat') return { ...b, itemTemplate: updateInTree((b as RepeatBlock).itemTemplate, id, patch) } as Block;
    return b;
  });
}
function removeFromTree(blocks: Block[], id: string): Block[] {
  return blocks.filter((b) => b.id !== id).map((b) => {
    if (b.type === 'group') return { ...b, blocks: removeFromTree((b as GroupBlock).blocks, id) };
    if (b.type === 'repeat') return { ...b, itemTemplate: removeFromTree((b as RepeatBlock).itemTemplate, id) };
    return b;
  });
}
function moveInTree(blocks: Block[], id: string, dir: -1 | 1): Block[] {
  const idx = blocks.findIndex((b) => b.id === id);
  if (idx >= 0) {
    const swap = idx + dir;
    if (swap < 0 || swap >= blocks.length) return blocks;
    const arr = blocks.slice();
    [arr[idx], arr[swap]] = [arr[swap], arr[idx]];
    return arr;
  }
  return blocks.map((b) => {
    if (b.type === 'group') return { ...b, blocks: moveInTree((b as GroupBlock).blocks, id, dir) };
    if (b.type === 'repeat') return { ...b, itemTemplate: moveInTree((b as RepeatBlock).itemTemplate, id, dir) };
    return b;
  });
}
function addToParent(blocks: Block[], parentId: string, child: Block): Block[] {
  return blocks.map((b) => {
    if (b.id === parentId && b.type === 'group') return { ...b, blocks: [...(b as GroupBlock).blocks, child] };
    if (b.id === parentId && b.type === 'repeat') return { ...b, itemTemplate: [...(b as RepeatBlock).itemTemplate, child] };
    if (b.type === 'group') return { ...b, blocks: addToParent((b as GroupBlock).blocks, parentId, child) };
    if (b.type === 'repeat') return { ...b, itemTemplate: addToParent((b as RepeatBlock).itemTemplate, parentId, child) };
    return b;
  });
}
function treeDepth(blocks: Block[], id: string, d = 0): number {
  for (const b of blocks) {
    if (b.id === id) return d;
    if (b.type === 'group') { const r = treeDepth((b as GroupBlock).blocks, id, d + 1); if (r >= 0) return r; }
    if (b.type === 'repeat') { const r = treeDepth((b as RepeatBlock).itemTemplate, id, d + 1); if (r >= 0) return r; }
  }
  return -1;
}

/* ---------- 新建块工厂 ---------- */
let blkSeq = 1;
function newId(prefix: string) { return `${prefix}-${Date.now().toString(36)}-${(blkSeq++).toString(36)}`; }
function makeBlock(type: BlockType): Block {
  const id = newId(type);
  switch (type) {
    case 'text': return { id, type, content: '{field:name}', role: 'title' };
    case 'image': return { id, type, binding: { source: 'image', path: 'portrait' }, placeholder: '图', width: 96, height: 96, round: false };
    case 'table': return {
      id, type, rows: 'customFields',
      columns: [
        { header: '项目', binding: { source: 'customField', path: '__key__' } },
        { header: '记录', binding: { source: 'customField', path: '__value__' } },
      ],
      staticRows: [{ cells: ['（无）', ''] }],
    };
    case 'divider': return { id, type };
    case 'icon': return { id, type, iconKey: 'star', size: 20, color: '#1f3a5f' };
    case 'barcode': return { id, type, binding: { source: 'customField', path: 'id', fallback: 'ID-0000' } };
    case 'signature': return { id, type, binding: { source: 'customField', path: 'signature', fallback: '—' }, label: '签名' };
    case 'spectrum': return { id, type, binding: { source: 'entity', path: 'spectrumColor' }, colorMode: 'binding' };
    case 'group': return { id, type, direction: 'row', blocks: [] };
    case 'repeat': return { id, type, source: { entityId: { source: 'customField', path: 'members', fallback: '' } }, itemTemplate: [] };
    case 'slot': return { id, type, slot: 'header' };
    case 'shape': return { id, type, shape: 'rect', width: 80, height: 40, fill: '#1f3a5f', stroke: '#1a1a1a', strokeWidth: 1, borderRadius: 4 };
    case 'chart': return { id, type, kind: 'bar', staticData: '力量,80\n敏捷,65\n智力,90', width: 260, height: 160, color: '#1f3a5f' };
    case 'flowchart': return { id, type, direction: 'row', staticSteps: '开始,处理,结束', stepColor: '#1f3a5f', arrowColor: '#6b6b6b' };
    case 'qrcode': return { id, type, staticValue: 'https://fugu.world', size: 120, color: '#1a1a1a', bgColor: '#ffffff' };
  }
}

const BLOCK_TYPES: { t: BlockType; label: string }[] = [
  { t: 'text', label: '文本' },
  { t: 'image', label: '图片' },
  { t: 'table', label: '表格' },
  { t: 'divider', label: '分隔线' },
  { t: 'group', label: '组(行/列)' },
  { t: 'repeat', label: '循环(关系)' },
  { t: 'barcode', label: '条形码' },
  { t: 'signature', label: '签名/印章' },
  { t: 'spectrum', label: '光谱条' },
  { t: 'icon', label: '图标' },
  { t: 'slot', label: '插槽' },
  { t: 'shape', label: '形状' },
  { t: 'chart', label: '图表' },
  { t: 'flowchart', label: '流程图' },
  { t: 'qrcode', label: '二维码' },
];

const SOURCES: BindingSource[] = ['entity', 'customField', 'world', 'style', 'static', 'relation', 'image', 'ai'];

function blockLabel(b: Block): string {
  switch (b.type) {
    case 'text': return `文本「${(b.content || '').slice(0, 14)}」`;
    case 'image': return `图片(${b.binding?.path})`;
    case 'table': return `表格(${b.rows})`;
    case 'group': return `组(${b.direction})·${b.blocks.length}`;
    case 'repeat': return `循环·${b.itemTemplate.length}`;
    case 'barcode': return `条码(${b.binding?.path})`;
    case 'signature': return `签名(${b.label})`;
    case 'spectrum': return `光谱(${b.binding?.path})`;
    case 'icon': return `图标(${b.iconKey})`;
    case 'slot': return `插槽(${b.slot})`;
    case 'divider': return '分隔线';
    case 'shape': return `形状(${b.shape})`;
    case 'chart': return `图表(${CHART_KIND_LABELS[b.kind] ?? b.kind})`;
    case 'flowchart': return `流程图(${b.direction})`;
    case 'qrcode': return '二维码';
    default: return '块';
  }
}

/* ---------- 文本字段来源快速选择器 ----------
 * 让 text 块的内容可以直接对应预览实体的名称/类型/结构化字段/通用字段，
 * 而不用手动记忆 {entity:...} / {field:...} 语法。              */

type FieldContentMode = 'text' | 'entityName' | 'entityType' | 'entityField' | 'customField';

function parseFieldContentMode(content: string): { mode: FieldContentMode; path: string } {
  const m = content.trim().match(/^\{(\w+):([^}]+)\}$/);
  if (!m) return { mode: 'text', path: '' };
  const [, src, path] = m;
  if (src === 'entity' && path === 'name') return { mode: 'entityName', path: '' };
  if (src === 'entity' && path === 'type') return { mode: 'entityType', path: '' };
  if (src === 'entity') return { mode: 'entityField', path };
  if (src === 'field' || src === 'customField') return { mode: 'customField', path };
  return { mode: 'text', path: '' };
}

function buildFieldContent(mode: FieldContentMode, path: string): string {
  switch (mode) {
    case 'entityName': return '{entity:name}';
    case 'entityType': return '{entity:type}';
    case 'entityField': return `{entity:${path}}`;
    case 'customField': return `{field:${path}}`;
    default: return '';
  }
}

function FieldSourcePicker({ content, previewEntity, onChange }: {
  content: string;
  previewEntity: WikiEntity | null;
  onChange: (content: string) => void;
}) {
  const { mode, path } = parseFieldContentMode(content);
  const entityFields = previewEntity?.fields ?? [];
  const materialFields = previewEntity?.materialFields;
  const customFieldKeys = materialFields ? Object.keys(materialFields) : [];

  const handleModeChange = (newMode: FieldContentMode) => {
    if (newMode === 'text') return; // 保留用户自定义文本，不自动替换
    if (newMode === 'entityField') {
      const first = entityFields[0]?.label ?? '';
      onChange(first ? buildFieldContent('entityField', first) : content);
      return;
    }
    if (newMode === 'customField') {
      const first = customFieldKeys[0] ?? '';
      onChange(first ? buildFieldContent('customField', first) : content);
      return;
    }
    onChange(buildFieldContent(newMode, ''));
  };

  return (
    <div className="te-field-source">
      <div className="te-row">
        <label>字段来源</label>
        <select value={mode} onChange={(e) => handleModeChange(e.target.value as FieldContentMode)}>
          <option value="text">自定义文本（可含插值）</option>
          <option value="entityName">实体名称 {"{entity:name}"}</option>
          <option value="entityType">实体类型 {"{entity:type}"}</option>
          <option value="entityField">结构化字段</option>
          <option value="customField">通用字段（materialFields）</option>
        </select>
      </div>
      {mode === 'entityField' && (
        <div className="te-row">
          <label>选择字段</label>
          <select value={path} onChange={(e) => onChange(buildFieldContent('entityField', e.target.value))}>
            {entityFields.length === 0 && <option value="">（当前实体无结构化字段）</option>}
            {entityFields.map((f) => <option key={f.label} value={f.label}>{f.label}</option>)}
          </select>
        </div>
      )}
      {mode === 'customField' && (
        <div className="te-row">
          <label>选择字段</label>
          <select value={path} onChange={(e) => onChange(buildFieldContent('customField', e.target.value))}>
            {customFieldKeys.length === 0 && <option value="">（当前实体无通用字段）</option>}
            {customFieldKeys.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
      )}
      {mode !== 'text' && (
        <div className="te-hint">当前内容：{content}</div>
      )}
    </div>
  );
}

/* ---------- 字段绑定快速选择器 ----------
 * 与 FieldSourcePicker 对应，但直接输出 FieldBinding，
 * 用于 spectrum / 其他需要绑定对象而非文本插值的场景。 */

type BindingPickerMode = 'entityName' | 'entityType' | 'entityField';

function parseBindingPickerMode(b: FieldBinding): { mode: BindingPickerMode; path: string } {
  if (b.source === 'entity' && b.path === 'name') return { mode: 'entityName', path: '' };
  if (b.source === 'entity' && b.path === 'type') return { mode: 'entityType', path: '' };
  if (b.source === 'entity') return { mode: 'entityField', path: b.path };
  return { mode: 'entityName', path: '' };
}

function buildBinding(mode: BindingPickerMode, path: string): FieldBinding {
  switch (mode) {
    case 'entityName': return { source: 'entity', path: 'name' };
    case 'entityType': return { source: 'entity', path: 'type' };
    case 'entityField': return { source: 'entity', path: path };
  }
}

function FieldBindingPicker({ binding, previewEntity, onChange }: {
  binding: FieldBinding;
  previewEntity: WikiEntity | null;
  onChange: (b: FieldBinding) => void;
}) {
  const { mode, path } = parseBindingPickerMode(binding);
  const entityFields = previewEntity?.fields ?? [];

  const handleModeChange = (newMode: BindingPickerMode) => {
    if (newMode === 'entityField') {
      const first = entityFields[0]?.label ?? '';
      onChange(first ? buildBinding('entityField', first) : binding);
      return;
    }
    onChange(buildBinding(newMode, ''));
  };

  return (
    <div className="te-field-source">
      <div className="te-row">
        <label>字段来源</label>
        <select value={mode} onChange={(e) => handleModeChange(e.target.value as BindingPickerMode)}>
          <option value="entityName">实体名称 {"{entity:name}"}</option>
          <option value="entityType">实体类型 {"{entity:type}"}</option>
          <option value="entityField">结构化字段</option>
        </select>
      </div>
      {mode === 'entityField' && (
        <div className="te-row">
          <label>选择字段</label>
          <select value={path} onChange={(e) => onChange(buildBinding('entityField', e.target.value))}>
            {entityFields.length === 0 && <option value="">（当前实体无结构化字段）</option>}
            {entityFields.map((f) => <option key={f.label} value={f.label}>{f.label}</option>)}
          </select>
        </div>
      )}
    </div>
  );
}

/* ---------- 绑定编辑器小部件 ---------- */
function BindingEditor({ binding, onChange, allowStatic }: {
  binding: FieldBinding;
  onChange: (b: FieldBinding) => void;
  allowStatic?: boolean;
}) {
  return (
    <div className="te-bind">
      <div className="te-row">
        <label>来源</label>
        <select value={binding.source} onChange={(e) => onChange({ ...binding, source: e.target.value as BindingSource })}>
          {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div className="te-row">
        <label>路径</label>
        <input
          value={binding.path}
          placeholder={binding.source === 'customField' ? 'materialFields 的 key，或 __key__/__value__' : binding.source === 'image' ? 'portrait / logo' : '如 name / worldName'}
          onChange={(e) => onChange({ ...binding, path: e.target.value })}
        />
      </div>
      <div className="te-row">
        <label>兜底</label>
        <input value={binding.fallback ?? ''} onChange={(e) => onChange({ ...binding, fallback: e.target.value })} placeholder="取不到时的文案" />
      </div>
      {allowStatic && (
        <div className="te-row">
          <label>static</label>
          <input value={binding.static ?? ''} onChange={(e) => onChange({ ...binding, static: e.target.value })} placeholder="固定文案" />
        </div>
      )}
    </div>
  );
}

/* ---------- 模板背景编辑器 ---------- */
function TemplateBackgroundEditor({ bg, onChange }: { bg: TemplateBackground | undefined; onChange: (bg: TemplateBackground | undefined) => void }) {
  const patch = (p: Partial<TemplateBackground>) => onChange({ color: '', image: '', imageOpacity: 1, imageSize: 'cover', imagePosition: 'center', imageRepeat: 'no-repeat', ...bg, ...p });
  const clear = () => onChange(undefined);
  const handleImage = (file: File) => {
    const rd = new FileReader();
    rd.onload = () => patch({ image: String(rd.result) });
    rd.readAsDataURL(file);
  };

  return (
    <div className="te-bg-editor">
      <div className="te-row">
        <label>背景色</label>
        <input type="color" value={bg?.color ?? ''} onChange={(e) => patch({ color: e.target.value })} />
        <button className="te-btn" onClick={() => patch({ color: '' })}>清除</button>
      </div>
      <div className="te-row">
        <label>背景图</label>
        <label className="te-btn" style={{ cursor: 'pointer' }}>
          上传图片
          <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImage(f); }} />
        </label>
        <button className="te-btn" onClick={() => patch({ image: '' })}>清除</button>
      </div>
      {bg?.image && (
        <div className="te-bg-preview">
          <img src={bg.image} alt="背景预览" />
        </div>
      )}
      <div className="te-row">
        <label>透明度</label>
        <input type="range" min={0} max={1} step={0.05} value={bg?.imageOpacity ?? 1} onChange={(e) => patch({ imageOpacity: Number(e.target.value) })} />
        <span>{Math.round((bg?.imageOpacity ?? 1) * 100)}%</span>
      </div>
      <div className="te-row">
        <label>填充方式</label>
        <select value={bg?.imageSize ?? 'cover'} onChange={(e) => patch({ imageSize: e.target.value as TemplateBackground['imageSize'] })}>
          <option value="cover">cover 铺满</option>
          <option value="contain">contain 适应</option>
          <option value="auto">auto 原始</option>
        </select>
      </div>
      <div className="te-row">
        <label>位置</label>
        <input value={bg?.imagePosition ?? 'center'} onChange={(e) => patch({ imagePosition: e.target.value })} placeholder="center / top left" />
      </div>
      <div className="te-row">
        <label>重复</label>
        <select value={bg?.imageRepeat ?? 'no-repeat'} onChange={(e) => patch({ imageRepeat: e.target.value as TemplateBackground['imageRepeat'] })}>
          <option value="no-repeat">不重复</option>
          <option value="repeat">平铺</option>
          <option value="repeat-x">水平重复</option>
          <option value="repeat-y">垂直重复</option>
        </select>
      </div>
      <div className="te-hint">背景会覆盖当前风格的纸张底色；留空则使用风格默认纸张色。</div>
      <button className="te-btn" onClick={clear}>重置为默认</button>
    </div>
  );
}

/* ---------- 模板编辑器主组件 ---------- */
export function TemplateEditor({ initialTemplate, onClose }: {
  initialTemplate?: MaterialTemplate | null;
  onClose: () => void;
}) {
  const styles = useWorldStore((s) => s.worldsData[s.current]?.styles ?? []);
  const entities = useWorldStore((s) => s.worldsData[s.current]?.entities ?? []);
  const userTemplates = useWorldStore((s) => s.worldsData[s.current]?.templates ?? []);
  const addTemplate = useWorldStore((s) => s.addTemplate);
  const updateTemplate = useWorldStore((s) => s.updateTemplate);
  const deleteTemplate = useWorldStore((s) => s.deleteTemplate);
  const worldview = useWorldviewStore();
  const worldName = worldview.worlds.find((w) => w.name === worldview.current)?.name ?? '世界观';
  const ui = useMaterialStore();

  // 初始草稿：复制 initialTemplate（若是内置则给新用户 id）
  const [draft, setDraft] = useState<MaterialTemplate>(() => {
    const base = initialTemplate ?? { id: '', name: '新模板', category: 'personnel', applicableStyles: '*' as const, blocks: [] };
    const isBuiltin = !!initialTemplate && !initialTemplate.id.startsWith('tpl-');
    return {
      ...base,
      id: isBuiltin ? newId('tpl') : (base.id || newId('tpl')),
      name: isBuiltin ? `${base.name}（副本）` : base.name,
      blocks: JSON.parse(JSON.stringify(base.blocks ?? [])),
    };
  });
  const [selId, setSelId] = useState<string | null>(draft.blocks[0]?.id ?? null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [previewEntityId, setPreviewEntityId] = useState<string | null>(entities[0]?.id ?? null);
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [addType, setAddType] = useState<BlockType>('text');
  // 预览区 DOM 引用，用于直接截图导出（WYSIWYG）
  const previewRef = useRef<HTMLDivElement>(null);

  const activeStyle = styles.find((s) => s.id === ui.activeStyleId);
  const token = activeStyle?.token ?? createDefaultStyleToken();
  const previewEntity = entities.find((e) => e.id === previewEntityId) ?? null;
  const ctx: RenderContext = useMemo(() => ({
    entity: previewEntity, worldName, token,
    portraitMode: ui.portraitMode, useAI: ui.useAI,
    allEntities: entities, aiValues: {},
  }), [previewEntity, worldName, token, ui.portraitMode, ui.useAI, entities]);
  const header = (token.layout.header ?? '{worldName}').replace(/\{worldName\}/g, worldName);

  const selBlock = selId ? findInTree(draft.blocks, selId) : null;

  function patchBlock(id: string, patch: Partial<Block>) {
    setDraft((d) => ({ ...d, blocks: updateInTree(d.blocks, id, patch) }));
  }
  function addBlock() {
    const child = makeBlock(addType);
    setDraft((d) => {
      if (selId) {
        const sel = findInTree(d.blocks, selId);
        if (sel && (sel.type === 'group' || sel.type === 'repeat')) {
          return { ...d, blocks: addToParent(d.blocks, selId, child) };
        }
      }
      return { ...d, blocks: [...d.blocks, child] };
    });
    setSelId(child.id);
  }
  function removeBlock(id: string) {
    setDraft((d) => ({ ...d, blocks: removeFromTree(d.blocks, id) }));
    if (selId === id) setSelId(null);
  }
  function moveBlock(id: string, dir: -1 | 1) {
    setDraft((d) => ({ ...d, blocks: moveInTree(d.blocks, id, dir) }));
  }

  function save(asCopy = false) {
    const name = (draft.name || '未命名模板').trim();
    if (asCopy) {
      const id = newId('tpl');
      addTemplate({ ...draft, id, name });
      setDraft((d) => ({ ...d, id, name }));
      setMsg({ kind: 'ok', text: `已另存为「${name}」✓` });
      return;
    }
    if (draft.id.startsWith('tpl-') && userTemplates.some((t) => t.id === draft.id)) {
      updateTemplate(draft.id, draft);
      setMsg({ kind: 'ok', text: `已更新「${name}」✓` });
    } else {
      const id = draft.id.startsWith('tpl-') ? draft.id : newId('tpl');
      addTemplate({ ...draft, id, name });
      setDraft((d) => ({ ...d, id, name }));
      setMsg({ kind: 'ok', text: `已保存为新模板「${name}」✓` });
    }
  }
  async function exportPreview() {
    if (!previewRef.current) { setMsg({ kind: 'err', text: '预览区尚未渲染' }); return; }
    const rect = previewRef.current.getBoundingClientRect();
    if (!rect.width || !rect.height) { setMsg({ kind: 'err', text: '预览区尺寸异常' }); return; }
    try {
      const ok = await (window.api?.exportPreviewPng?.(
        { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        `${worldName}_${draft.name || 'template'}_${previewEntity?.name ?? 'preview'}`,
      ) ?? false);
      setMsg({ kind: ok ? 'ok' : 'err', text: ok ? '已导出预览图 ✓' : '已取消或导出失败' });
    } catch {
      setMsg({ kind: 'err', text: '导出预览图出错' });
    }
  }
  function handleDelete() {
    if (!draft.id.startsWith('tpl-')) { setMsg({ kind: 'err', text: '内置模板不能直接删除，可另存为用户模板后管理。' }); return; }
    if (!confirm(`删除模板「${draft.name}」？此操作不可撤销。`)) return;
    deleteTemplate(draft.id);
    setMsg({ kind: 'ok', text: `已删除「${draft.name}」` });
    onClose();
  }
  function exportJson() {
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${draft.id || 'template'}.fugutemplate.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function importJson(file: File) {
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const obj = JSON.parse(String(rd.result)) as MaterialTemplate;
        if (!obj.blocks) throw new Error('缺少 blocks');
        const id = newId('tpl');
        setDraft({ ...obj, id });
        setSelId(obj.blocks[0]?.id ?? null);
        setMsg({ kind: 'ok', text: `已导入模板「${obj.name}」✓` });
      } catch (e: any) {
        setMsg({ kind: 'err', text: '导入失败：' + (e?.message || 'JSON 解析错误') });
      }
    };
    rd.readAsText(file);
  }
  function applyJson() {
    try {
      const obj = JSON.parse(jsonText) as MaterialTemplate;
      if (!obj.blocks) throw new Error('缺少 blocks');
      setDraft(obj);
      setSelId(obj.blocks[0]?.id ?? null);
      setMsg({ kind: 'ok', text: 'JSON 已应用 ✓' });
    } catch (e: any) {
      setMsg({ kind: 'err', text: 'JSON 解析失败：' + (e?.message || String(e)) });
    }
  }

  return (
    <div className="te-modal-backdrop" onClick={onClose}>
      <div className="te-modal" onClick={(e) => e.stopPropagation()}>
        {/* 顶部栏 */}
        <div className="te-top">
          <div className="te-top-title">模板编辑器</div>
          <div className="te-top-actions">
            <button className="te-btn te-btn-primary" onClick={exportPreview}>导出预览图</button>
            <button className="te-btn" onClick={() => setJsonMode((v) => !v)}>JSON 模式</button>
            <button className="te-btn" onClick={exportJson}>导出 JSON</button>
            <label className="te-btn" style={{ cursor: 'pointer' }}>
              导入 JSON
              <input type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) importJson(f); }} />
            </label>
            <button className="te-btn" onClick={() => save(true)}>另存为副本</button>
            <button className="te-btn te-btn-primary" onClick={() => save(false)}>保存</button>
            <button className="te-btn te-btn-danger" onClick={handleDelete}>删除</button>
            <button className="te-btn" onClick={onClose}>关闭</button>
          </div>
        </div>

        {msg && <div className={'te-msg ' + (msg.kind === 'ok' ? 'te-msg-ok' : 'te-msg-err')}>{msg.text}</div>}

        <div className="te-body">
          {/* 左：元信息 + 块树 */}
          <aside className="te-col te-col-left">
            <div className="te-meta">
              <div className="te-row"><label>名称</label><input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} /></div>
              <div className="te-row">
                <label>分类</label>
                <select value={draft.category} onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value as TemplateCategory }))}>
                  {(Object.keys(CATEGORY_LABELS) as TemplateCategory[]).map((c) => (
                    <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                  ))}
                </select>
              </div>
              <div className="te-row"><label>画幅</label>
                <select value={draft.pageOverride ?? ''} onChange={(e) => setDraft((d) => ({ ...d, pageOverride: (e.target.value || undefined) as MaterialTemplate['pageOverride'] }))}>
                  <option value="">跟随风格</option>
                  {(['A4', 'A5', 'A6', 'square', 'id_card', 'poster', 'custom'] as const).map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div className="te-row"><label>适用风格</label>
                <input value={Array.isArray(draft.applicableStyles) ? draft.applicableStyles.join(',') : draft.applicableStyles} onChange={(e) => setDraft((d) => ({ ...d, applicableStyles: e.target.value.trim() === '*' ? '*' : e.target.value.split(',').map((s) => s.trim()).filter(Boolean) }))} placeholder="* 表示风格无关" />
              </div>
              <div className="te-row"><label>说明</label><input value={draft.description ?? ''} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} /></div>

              <details className="te-meta-bg">
                <summary>自定义背景</summary>
                <TemplateBackgroundEditor
                  bg={draft.background}
                  onChange={(bg) => setDraft((d) => ({ ...d, background: bg }))}
                />
              </details>
            </div>

            <div className="te-tree-head">
              <span>块树</span>
              <span className="te-tree-hint">选中组/循环后添加 → 进子级</span>
            </div>
            <div className="te-tree">
              {draft.blocks.length === 0 && <div className="te-empty">暂无块，从下方添加。</div>}
              {draft.blocks.map((b) => (
                <TreeNode key={b.id} b={b} depth={0} selId={selId} hoverId={hoverId} onSelect={setSelId} onHover={setHoverId} onMove={moveBlock} onRemove={removeBlock} />
              ))}
            </div>

            <div className="te-add">
              <select value={addType} onChange={(e) => setAddType(e.target.value as BlockType)}>
                {BLOCK_TYPES.map((x) => <option key={x.t} value={x.t}>{x.label}</option>)}
              </select>
              <button className="te-btn te-btn-primary" onClick={addBlock}>＋ 添加块</button>
            </div>
          </aside>

          {/* 中：预览 */}
          <main className="te-col te-col-center">
            <div className="te-preview-bar">
              <span>预览</span>
              <select value={previewEntityId ?? ''} onChange={(e) => setPreviewEntityId(e.target.value || null)}>
                <option value="">— 无主体 —</option>
                {entities.map((e) => <option key={e.id} value={e.id}>{e.name}（{e.type}）</option>)}
              </select>
              <span className="te-preview-hint">使用当前风格 {activeStyle ? activeStyle.name : '（默认）'}</span>
            </div>
            {jsonMode ? (
              <div className="te-json-wrap">
                <textarea className="te-json" value={jsonText} onChange={(e) => setJsonText(e.target.value)} placeholder="点「载入当前」把左侧模板转为 JSON 在此编辑" />
                <div className="te-json-ops">
                  <button className="te-btn" onClick={() => setJsonText(JSON.stringify(draft, null, 2))}>载入当前</button>
                  <button className="te-btn te-btn-primary" onClick={applyJson}>应用 JSON</button>
                </div>
              </div>
            ) : (
              <div className="te-preview-scroll">
                <div ref={previewRef} className="te-preview-capture-wrap">
                  <MaterialPreview token={token} header={header} template={{ ...draft, id: draft.id || 'preview' }} ctx={ctx} scale={0.62} highlightId={hoverId ?? undefined} />
                </div>
              </div>
            )}
          </main>

          {/* 右：属性 */}
          <aside className="te-col te-col-right">
            {!selBlock ? (
              <div className="te-empty">在左侧选择一个块以编辑属性。</div>
            ) : (
              <BlockProps block={selBlock} previewEntity={previewEntity} onChange={(patch) => patchBlock(selBlock.id, patch)} />
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

/* ---------- 树节点 ---------- */
function TreeNode({ b, depth, selId, hoverId, onSelect, onHover, onMove, onRemove }: {
  b: Block; depth: number; selId: string | null; hoverId: string | null;
  onSelect: (id: string) => void; onHover: (id: string | null) => void;
  onMove: (id: string, dir: -1 | 1) => void; onRemove: (id: string) => void;
}) {
  const children = b.type === 'group' ? (b as GroupBlock).blocks : b.type === 'repeat' ? (b as RepeatBlock).itemTemplate : [];
  return (
    <div className="te-node">
      <div
        className={'te-node-row' + (selId === b.id ? ' active' : '') + (hoverId === b.id ? ' hovering' : '')}
        style={{ paddingLeft: 6 + depth * 14 }}
        onClick={() => onSelect(b.id)}
        onMouseEnter={() => onHover(b.id)}
        onMouseLeave={() => onHover(null)}
      >
        <span className="te-node-type">{b.type}</span>
        <span className="te-node-label">{blockLabel(b)}</span>
        <span className="te-node-ops">
          <button onClick={(e) => { e.stopPropagation(); onMove(b.id, -1); }} title="上移">↑</button>
          <button onClick={(e) => { e.stopPropagation(); onMove(b.id, 1); }} title="下移">↓</button>
          <button onClick={(e) => { e.stopPropagation(); onRemove(b.id); }} title="删除">✕</button>
        </span>
      </div>
      {children.map((c) => (
        <TreeNode key={c.id} b={c} depth={depth + 1} selId={selId} hoverId={hoverId} onSelect={onSelect} onHover={onHover} onMove={onMove} onRemove={onRemove} />
      ))}
    </div>
  );
}

/* ---------- 选中块的属性面板（按 type 分支） ---------- */
function BlockProps({ block, previewEntity, onChange }: { block: Block; previewEntity: WikiEntity | null; onChange: (patch: Partial<Block>) => void }) {
  const b = block as any;
  return (
    <div className="te-props">
      <div className="te-props-type">类型：{b.type} · id：{b.id}</div>

      {b.type === 'text' && (
        <>
          <FieldSourcePicker
            content={b.content ?? ''}
            previewEntity={previewEntity}
            onChange={(content) => onChange({ content } as Partial<Block>)}
          />
          <div className="te-field"><label>内容（支持 {'{field:path}'} / {'{entity:字段}'} 插值）</label>
            <textarea value={b.content ?? ''} onChange={(e) => onChange({ content: e.target.value } as Partial<Block>)} />
          </div>
          <div className="te-field"><label>角色</label>
            <select value={b.role ?? ''} onChange={(e) => onChange({ role: e.target.value as any } as Partial<Block>)}>
              {['title', 'body', 'label', 'value', 'caption'].map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          {b.binding ? (
            <div className="te-field"><label>绑定</label><BindingEditor binding={b.binding} onChange={(bd) => onChange({ binding: bd } as Partial<Block>)} allowStatic /></div>
          ) : (
            <button className="te-btn" onClick={() => onChange({ binding: { source: 'customField', path: '', fallback: '' } } as Partial<Block>)}>＋ 添加字段绑定</button>
          )}
        </>
      )}

      {b.type === 'image' && (
        <>
          <div className="te-field"><label>绑定</label><BindingEditor binding={b.binding ?? { source: 'image', path: 'portrait' }} onChange={(bd) => onChange({ binding: bd } as Partial<Block>)} /></div>
          <div className="te-row"><label>占位</label><input value={b.placeholder ?? ''} onChange={(e) => onChange({ placeholder: e.target.value } as Partial<Block>)} /></div>
          <div className="te-row"><label>圆形</label><input type="checkbox" checked={!!b.round} onChange={(e) => onChange({ round: e.target.checked } as Partial<Block>)} /></div>
          <div className="te-row"><label>宽(px)</label><input type="number" value={b.width ?? 96} onChange={(e) => onChange({ width: Number(e.target.value) } as Partial<Block>)} /></div>
          <div className="te-row"><label>高(px)</label><input type="number" value={b.height ?? 96} onChange={(e) => onChange({ height: Number(e.target.value) } as Partial<Block>)} /></div>
        </>
      )}

      {b.type === 'table' && (
        <>
          <div className="te-field"><label>行来源</label>
            <select value={b.rows} onChange={(e) => onChange({ rows: e.target.value as any } as Partial<Block>)}>
              {['customFields', 'entityFields', 'static'].map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="te-field"><label>列（header / 绑定路径）</label>
            {(b.columns ?? []).map((col: any, i: number) => (
              <div key={i} className="te-col-edit">
                <input value={col.header} onChange={(e) => { const cs = (b.columns ?? []).slice(); cs[i] = { ...cs[i], header: e.target.value }; onChange({ columns: cs } as Partial<Block>); }} placeholder="表头" />
                <input value={col.binding?.path ?? ''} onChange={(e) => { const cs = (b.columns ?? []).slice(); cs[i] = { ...cs[i], binding: { source: (col.binding?.source ?? 'customField'), path: e.target.value } }; onChange({ columns: cs } as Partial<Block>); }} placeholder="__key__/__value__/field" />
                <button onClick={() => { const cs = (b.columns ?? []).slice(); cs.splice(i, 1); onChange({ columns: cs } as Partial<Block>); }}>✕</button>
              </div>
            ))}
            <button className="te-btn" onClick={() => onChange({ columns: [...(b.columns ?? []), { header: '新列', binding: { source: 'customField', path: '' } }] } as Partial<Block>)}>＋ 加列</button>
          </div>
        </>
      )}

      {b.type === 'group' && (
        <>
          <div className="te-row"><label>方向</label>
            <select value={b.direction ?? 'row'} onChange={(e) => onChange({ direction: e.target.value as 'row' | 'col' } as Partial<Block>)}>
              <option value="row">row（横排）</option>
              <option value="col">col（竖排）</option>
            </select>
          </div>
          <div className="te-hint">在左侧块树选中本组，点「＋添加块」即可追加子块。</div>
        </>
      )}

      {b.type === 'repeat' && (
        <>
          <div className="te-field"><label>成员 ID 绑定</label>
            <BindingEditor binding={b.source?.entityId ?? { source: 'customField', path: 'members', fallback: '' }} onChange={(bd) => onChange({ source: { entityId: bd } } as Partial<Block>)} />
          </div>
          <div className="te-hint">在所选实体的 materialFields 写入 members=实体ID1,实体ID2… 即可循环列出。选中本循环后在左栏可编辑 itemTemplate 子块。</div>
        </>
      )}

      {b.type === 'barcode' && <div className="te-field"><label>绑定</label><BindingEditor binding={b.binding ?? { source: 'customField', path: 'id', fallback: 'ID-0000' }} onChange={(bd) => onChange({ binding: bd } as Partial<Block>)} /></div>}
      {b.type === 'spectrum' && (
        <>
          <div className="te-field"><label>颜色模式</label>
            <select value={(b as any).colorMode ?? 'binding'} onChange={(e) => onChange({ colorMode: e.target.value as SpectrumColorMode } as Partial<Block>)}>
              <option value="binding">绑定值作为颜色</option>
              <option value="custom">自定义颜色</option>
              <option value="rules">条件规则匹配颜色</option>
            </select>
          </div>
          {(b as any).colorMode === 'custom' && (
            <div className="te-row"><label>自定义颜色</label><input type="color" value={(b as any).customColor ?? '#3aa0ff'} onChange={(e) => onChange({ customColor: e.target.value } as Partial<Block>)} /></div>
          )}
          {(b as any).colorMode === 'rules' && (
            <>
              <div className="te-field"><label>检测字段</label>
                <FieldBindingPicker binding={(b as any).detectBinding ?? { source: 'entity', path: 'type' }} previewEntity={previewEntity} onChange={(bd) => onChange({ detectBinding: bd } as Partial<Block>)} />
              </div>
              <div className="te-field"><label>颜色规则</label>
                {(((b as any).colorRules ?? []) as SpectrumColorRule[]).map((rule, idx) => (
                  <div key={idx} className="te-row" style={{ alignItems: 'center', gap: 6 }}>
                    <select value={rule.operator ?? 'eq'} onChange={(e) => {
                      const rules = [...((b as any).colorRules ?? [])];
                      rules[idx] = { ...rule, operator: e.target.value as SpectrumColorRule['operator'] };
                      onChange({ colorRules: rules } as Partial<Block>);
                    }}>
                      <option value="eq">等于</option>
                      <option value="contains">包含</option>
                      <option value="startsWith">开头是</option>
                      <option value="endsWith">结尾是</option>
                    </select>
                    <input value={rule.value} placeholder="检测值" onChange={(e) => {
                      const rules = [...((b as any).colorRules ?? [])];
                      rules[idx] = { ...rule, value: e.target.value };
                      onChange({ colorRules: rules } as Partial<Block>);
                    }} />
                    <input type="color" value={rule.color} onChange={(e) => {
                      const rules = [...((b as any).colorRules ?? [])];
                      rules[idx] = { ...rule, color: e.target.value };
                      onChange({ colorRules: rules } as Partial<Block>);
                    }} />
                    <button className="te-btn-small" onClick={() => {
                      const rules = [...((b as any).colorRules ?? [])];
                      rules.splice(idx, 1);
                      onChange({ colorRules: rules } as Partial<Block>);
                    }}>删除</button>
                  </div>
                ))}
                <button className="te-btn-small" onClick={() => {
                  const rules = [...((b as any).colorRules ?? [])];
                  rules.push({ value: '', color: '#3aa0ff', operator: 'eq' });
                  onChange({ colorRules: rules } as Partial<Block>);
                }}>+ 添加规则</button>
              </div>
              <div className="te-field"><label>绑定</label><BindingEditor binding={b.binding ?? { source: 'entity', path: 'spectrumColor' }} onChange={(bd) => onChange({ binding: bd } as Partial<Block>)} /></div>
            </>
          )}
          {(b as any).colorMode !== 'rules' && (
            <div className="te-field"><label>绑定</label><BindingEditor binding={b.binding ?? { source: 'entity', path: 'spectrumColor' }} onChange={(bd) => onChange({ binding: bd } as Partial<Block>)} /></div>
          )}
        </>
      )}
      {b.type === 'signature' && (
        <>
          <div className="te-row"><label>标签</label><input value={b.label ?? ''} onChange={(e) => onChange({ label: e.target.value } as Partial<Block>)} /></div>
          <div className="te-field"><label>绑定</label><BindingEditor binding={b.binding ?? { source: 'customField', path: 'signature', fallback: '—' }} onChange={(bd) => onChange({ binding: bd } as Partial<Block>)} /></div>
        </>
      )}
      {b.type === 'icon' && (
        <>
          <div className="te-row"><label>图标键</label><input value={b.iconKey ?? ''} onChange={(e) => onChange({ iconKey: e.target.value } as Partial<Block>)} /></div>
          <div className="te-row"><label>尺寸</label><input type="number" value={b.size ?? 20} onChange={(e) => onChange({ size: Number(e.target.value) } as Partial<Block>)} /></div>
          <div className="te-row"><label>颜色</label><input type="color" value={b.color ?? '#1f3a5f'} onChange={(e) => onChange({ color: e.target.value } as Partial<Block>)} /></div>
          <div className="te-row"><label>旋转(deg)</label><input type="number" value={b.rotate ?? 0} onChange={(e) => onChange({ rotate: Number(e.target.value) } as Partial<Block>)} /></div>
        </>
      )}
      {b.type === 'slot' && <div className="te-row"><label>插槽名</label><input value={b.slot ?? ''} onChange={(e) => onChange({ slot: e.target.value } as Partial<Block>)} /></div>}
      {b.type === 'divider' && <div className="te-hint">分隔线无额外属性。</div>}

      {b.type === 'shape' && (
        <>
          <div className="te-row"><label>形状</label>
            <select value={b.shape ?? 'rect'} onChange={(e) => onChange({ shape: e.target.value as any } as Partial<Block>)}>
              {['rect', 'circle', 'ellipse', 'triangle', 'line', 'star', 'diamond'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="te-row"><label>宽(px)</label><input type="number" value={b.width ?? 80} onChange={(e) => onChange({ width: Number(e.target.value) } as Partial<Block>)} /></div>
          <div className="te-row"><label>高(px)</label><input type="number" value={b.height ?? 40} onChange={(e) => onChange({ height: Number(e.target.value) } as Partial<Block>)} /></div>
          <div className="te-row"><label>填充</label><input type="color" value={b.fill ?? '#1f3a5f'} onChange={(e) => onChange({ fill: e.target.value } as Partial<Block>)} /></div>
          <div className="te-row"><label>描边</label><input type="color" value={b.stroke ?? '#1a1a1a'} onChange={(e) => onChange({ stroke: e.target.value } as Partial<Block>)} /></div>
          <div className="te-row"><label>描边宽</label><input type="number" value={b.strokeWidth ?? 1} onChange={(e) => onChange({ strokeWidth: Number(e.target.value) } as Partial<Block>)} /></div>
          {b.shape === 'rect' && <div className="te-row"><label>圆角</label><input type="number" value={b.borderRadius ?? 4} onChange={(e) => onChange({ borderRadius: Number(e.target.value) } as Partial<Block>)} /></div>}
          <div className="te-row"><label>旋转(deg)</label><input type="number" value={b.rotation ?? 0} onChange={(e) => onChange({ rotation: Number(e.target.value) } as Partial<Block>)} /></div>
        </>
      )}

      {b.type === 'chart' && (
        <>
          <div className="te-row"><label>图表类型</label>
            <select value={b.kind ?? 'bar'} onChange={(e) => onChange({ kind: e.target.value as ChartKind } as Partial<Block>)}>
              {(['bar', 'line', 'pie', 'donut', 'radar'] as ChartKind[]).map((k) => (
                <option key={k} value={k}>{CHART_KIND_LABELS[k]}</option>
              ))}
            </select>
          </div>
          <div className="te-field"><label>数据绑定</label><BindingEditor binding={b.binding ?? { source: 'customField', path: 'stats', fallback: '' }} onChange={(bd) => onChange({ binding: bd } as Partial<Block>)} /></div>
          <div className="te-field"><label>静态数据（CSV: 标签,值）</label>
            <textarea value={b.staticData ?? ''} onChange={(e) => onChange({ staticData: e.target.value } as Partial<Block>)} placeholder={'力量,80\n敏捷,65\n智力,90'} rows={4} />
          </div>
          <div className="te-row"><label>宽(px)</label><input type="number" value={b.width ?? 260} onChange={(e) => onChange({ width: Number(e.target.value) } as Partial<Block>)} /></div>
          <div className="te-row"><label>高(px)</label><input type="number" value={b.height ?? 160} onChange={(e) => onChange({ height: Number(e.target.value) } as Partial<Block>)} /></div>
          <div className="te-row"><label>主色</label><input type="color" value={b.color ?? '#1f3a5f'} onChange={(e) => onChange({ color: e.target.value } as Partial<Block>)} /></div>
        </>
      )}

      {b.type === 'flowchart' && (
        <>
          <div className="te-row"><label>方向</label>
            <select value={b.direction ?? 'row'} onChange={(e) => onChange({ direction: e.target.value as 'row' | 'col' } as Partial<Block>)}>
              <option value="row">横向</option>
              <option value="col">纵向</option>
            </select>
          </div>
          <div className="te-field"><label>步骤绑定</label><BindingEditor binding={b.binding ?? { source: 'customField', path: 'flow', fallback: '' }} onChange={(bd) => onChange({ binding: bd } as Partial<Block>)} /></div>
          <div className="te-row"><label>静态步骤（逗号分隔）</label><input value={b.staticSteps ?? ''} onChange={(e) => onChange({ staticSteps: e.target.value } as Partial<Block>)} placeholder="开始,处理,结束" /></div>
          <div className="te-row"><label>步骤色</label><input type="color" value={b.stepColor ?? '#1f3a5f'} onChange={(e) => onChange({ stepColor: e.target.value } as Partial<Block>)} /></div>
          <div className="te-row"><label>箭头色</label><input type="color" value={b.arrowColor ?? '#6b6b6b'} onChange={(e) => onChange({ arrowColor: e.target.value } as Partial<Block>)} /></div>
        </>
      )}

      {b.type === 'qrcode' && (
        <>
          <div className="te-field"><label>内容绑定</label><BindingEditor binding={b.binding ?? { source: 'customField', path: 'qrcode', fallback: '' }} onChange={(bd) => onChange({ binding: bd } as Partial<Block>)} /></div>
          <div className="te-row"><label>静态内容</label><input value={b.staticValue ?? ''} onChange={(e) => onChange({ staticValue: e.target.value } as Partial<Block>)} placeholder="https://..." /></div>
          <div className="te-row"><label>尺寸(px)</label><input type="number" value={b.size ?? 120} onChange={(e) => onChange({ size: Number(e.target.value) } as Partial<Block>)} /></div>
          <div className="te-row"><label>前景色</label><input type="color" value={b.color ?? '#1a1a1a'} onChange={(e) => onChange({ color: e.target.value } as Partial<Block>)} /></div>
          <div className="te-row"><label>背景色</label><input type="color" value={b.bgColor ?? '#ffffff'} onChange={(e) => onChange({ bgColor: e.target.value } as Partial<Block>)} /></div>
        </>
      )}

      {/* 通用：条件渲染 + 行内样式 */}
      <div className="te-props-common">
        <details>
          <summary>条件渲染 showIf</summary>
          <div className="te-field">
            <label>来源</label>
            <select value={b.showIf?.source ?? ''} onChange={(e) => onChange({ showIf: e.target.value ? { source: e.target.value as BindingSource, path: b.showIf?.path ?? '', notEmpty: b.showIf?.notEmpty } : undefined } as Partial<Block>)}>
              <option value="">无</option>
              {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {b.showIf && (
            <>
              <div className="te-row"><label>路径</label><input value={b.showIf.path ?? ''} onChange={(e) => onChange({ showIf: { ...b.showIf, path: e.target.value } } as Partial<Block>)} /></div>
              <div className="te-row"><label>不为空才显示</label><input type="checkbox" checked={!!b.showIf.notEmpty} onChange={(e) => onChange({ showIf: { ...b.showIf, notEmpty: e.target.checked } } as Partial<Block>)} /></div>
              <div className="te-row"><label>等于</label><input value={b.showIf.equals ?? ''} onChange={(e) => onChange({ showIf: { ...b.showIf, equals: e.target.value || undefined } } as Partial<Block>)} /></div>
            </>
          )}
        </details>
        <details>
          <summary>行内样式 style（JSON）</summary>
          <textarea className="te-style-json" value={b.style ? JSON.stringify(b.style) : ''} onChange={(e) => {
            if (!e.target.value.trim()) { onChange({ style: undefined } as Partial<Block>); return; }
            try { const o = JSON.parse(e.target.value); onChange({ style: o } as Partial<Block>); } catch { /* 暂存为文本不应用 */ }
          }} placeholder='{"gap":"10px","color":"#333"}' />
        </details>
      </div>
    </div>
  );
}
