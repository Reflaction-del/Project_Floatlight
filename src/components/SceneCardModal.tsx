// ============================================================
// 多模态设卡弹窗（Phase 2 · 功能2）
// ------------------------------------------------------------
// 用户上传 / 粘贴一张图片（角色立绘 / 场景 / 徽记 / 概念图），
// 调 vision 模型抽取设卡信息；结果可编辑，并实时用 idCard 模板
// 渲染「文字 + 图片」卡片预览；确认后作为实体提案进入统一提案队列。
// ============================================================

import { useRef, useState, useMemo } from 'react';
import { useWorldStore } from '../store/worldStore';
import { useUIStore } from '../store/uiStore';
import { useWorldviewStore } from '../store/worldviewStore';
import { ENTITY_LABEL } from '../types';
import type { EntityType, WikiEntity } from '../types';
import { sceneToCard } from '../features/ai/sceneToCard';
import type { NewEntityInput } from '../store/proposalTypes';
import { MaterialPreview } from '../features/materials/Preview';
import { MATERIAL_TEMPLATES, getTemplate } from '../features/materials/templates/registry';
import { createDefaultStyleToken } from '../features/materials/types';
import type { MaterialTemplate, StyleToken } from '../features/materials/types';
import type { RenderContext } from '../features/materials/bindings';
import { downscaleImage } from '../utils/image';

const ID_CARD = getTemplate('idCard', MATERIAL_TEMPLATES)!;
const ENTITY_TYPES: EntityType[] = ['character', 'faction', 'location', 'event', 'rule'];

interface FieldRow { key: string; value: string }

export function SceneCardModal({ onClose }: { onClose: () => void }) {
  const worldview = useWorldviewStore();
  const worldName = worldview.worlds.find((w) => w.name === worldview.current)?.name ?? '世界观';
  const addProposal = useWorldStore.getState().addProposal;
  const setProposals = useUIStore((s) => s.setProposals);

  const [image, setImage] = useState<string | null>(null);
  const [hint, setHint] = useState('');
  const [typeHint, setTypeHint] = useState<EntityType | ''>('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 可编辑结果
  const [name, setName] = useState('');
  const [type, setType] = useState<EntityType>('character');
  const [description, setDescription] = useState('');
  const [motto, setMotto] = useState('');
  const [serial, setSerial] = useState('');
  const [caption, setCaption] = useState('');
  const [fields, setFields] = useState<FieldRow[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const hasResult = name.trim().length > 0;

  function pickImage(dataUrl: string) {
    setError(null);
    // 先把可能数 MB 的原图降采样到合理尺寸，避免巨型 base64 长期驻留状态、
    // 每次按键都重建预览对象并重渲染 MaterialPreview（主线程 CPU/内存暴涨）。
    downscaleImage(dataUrl, 1024, 0.85).then(setImage);
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => pickImage(rd.result as string);
    rd.readAsDataURL(f);
  }

  function onPaste(e: React.ClipboardEvent) {
    const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith('image/'));
    if (!item) return;
    const blob = item.getAsFile();
    if (!blob) return;
    const rd = new FileReader();
    rd.onload = () => pickImage(rd.result as string);
    rd.readAsDataURL(blob);
  }

  async function runExtract() {
    if (!image) {
      setError('请先上传或粘贴一张图片。');
      return;
    }
    setBusy(true);
    setError(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const r = await sceneToCard(image, worldName, { hint, typeHint: typeHint || undefined }, ctrl.signal);
      setName(r.name);
      setType(r.type);
      
      setDescription(r.description);
      setMotto(r.motto ?? '');
      setSerial(r.serial ?? '');
      setCaption(r.caption ?? '');
      setFields(Object.entries(r.materialFields).map(([k, v]) => ({ key: k, value: v })));
    } catch (err: any) {
      if (ctrl.signal.aborted) return;
      setError('设卡失败：' + (err?.message || String(err)));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  function cancelExtract() {
    abortRef.current?.abort();
    setBusy(false);
  }

  function updateField(i: number, patch: Partial<FieldRow>) {
    setFields((prev) => prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }
  function addField() { setFields((prev) => [...prev, { key: '', value: '' }]); }
  function removeField(i: number) { setFields((prev) => prev.filter((_, idx) => idx !== i)); }

  function toProposal() {
    if (!name.trim()) { setError('实体名不能为空。'); return; }
    const record: Record<string, string> = {};
    for (const f of fields) {
      if (f.key.trim()) record[f.key.trim()] = f.value;
    }
    if (serial.trim()) record['id'] = serial.trim(); // 让 idCard 条形码显示编号
    if (motto.trim()) record['signature'] = motto.trim();

    const entity: NewEntityInput = {
      type,
      name: name.trim(),
      
      materialFields: record,
      note: description.trim() || caption.trim() || undefined,
      images: image ? [{ id: 'img', dataUrl: image, createdAt: 0 }] : undefined,
      coverImageId: image ? 'img' : undefined,
      portrait: image ? { mode: 'upload', uploadSrc: image } : undefined,
    };
    addProposal({
      source: 'scene',
      op: { kind: 'addEntity', entity },
      summary: `多模态设卡：新增${ENTITY_LABEL[type]}「${name.trim()}」`,
    });
    setProposals(true);
    onClose();
  }

  // —— 实时卡片预览（复用 idCard 模板，文字 + 图片）——
  const token: StyleToken = createDefaultStyleToken();
  // 仅在影响预览的字段变化时重建预览实体，避免无关输入（如提示词、类别预设）
  // 触发含多 MB 图片的对象重建与 MaterialPreview 重渲染。
  const previewEntity: WikiEntity | null = useMemo(() => {
    if (!image || !hasResult) return null;
    const rec: Record<string, string> = {};
    for (const f of fields) if (f.key.trim()) rec[f.key.trim()] = f.value;
    if (serial.trim()) rec['id'] = serial.trim();
    if (motto.trim()) rec['signature'] = motto.trim();
    return {
      id: '__scene_preview__',
      type,
      name: name.trim() || '（未命名）',
      
      fields: [],
      custom: [],
      tags: [],
      note: description,
      images: [{ id: 'img', dataUrl: image, createdAt: 0 }],
      coverImageId: 'img',
      portrait: { mode: 'upload', uploadSrc: image },
      materialFields: rec,
      createdAt: 0,
      updatedAt: 0,
    };
  }, [image, hasResult, type, name, description, fields, serial, motto]);
  const ctx: RenderContext = {
    entity: previewEntity,
    worldName,
    token,
    portraitMode: 'upload',
    useAI: false,
    allEntities: [],
    aiValues: {},
  };

  return (
    <div className="modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal scene-modal" onPaste={onPaste}>
        <div className="modal-head">
          <span>多模态设卡（图片 → 实体卡）</span>
          <button className="modal-x" onClick={onClose}>×</button>
        </div>

        <div className="scene-body">
          {/* 左：输入 + 结果编辑 */}
          <div className="scene-left">
            <div
              className="scene-drop"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (!f) return;
                const rd = new FileReader();
                rd.onload = () => pickImage(rd.result as string);
                rd.readAsDataURL(f);
              }}
            >
              {image ? (
                <img className="scene-thumb" src={image} alt="待设卡图片" />
              ) : (
                <div className="scene-drop-hint">
                  点击上传 / 拖拽 / 直接粘贴（Ctrl+V）一张图片
                  <br />支持角色立绘、场景图、徽记、概念图等
                </div>
              )}
              <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onFile} />
            </div>

            <div className="scene-field">
              <label>补充文字提示 / 世界观背景（可选）</label>
              <textarea
                className="scene-text"
                value={hint}
                onChange={(e) => setHint(e.target.value)}
                placeholder="例如：这是某个赛博城邦的执法官；世界观偏冷峻压抑…"
                rows={2}
              />
            </div>

            <div className="scene-field scene-field-row">
              <div className="scene-col">
                <label>类别预设（可选）</label>
                <select value={typeHint} onChange={(e) => setTypeHint(e.target.value as EntityType | '')}>
                  <option value="">自动识别</option>
                  {ENTITY_TYPES.map((t) => (
                    <option key={t} value={t}>{ENTITY_LABEL[t]}</option>
                  ))}
                </select>
              </div>
              <button
                className="mf-export-btn scene-run"
                onClick={busy ? cancelExtract : runExtract}
                disabled={!image}
              >
                {busy ? '停止' : 'AI 设卡'}
              </button>
            </div>

            {error && <div className="scene-error">{error}</div>}

            {hasResult && (
              <div className="scene-edit">
                <div className="scene-field scene-field-row">
                  <div className="scene-col">
                    <label>名称</label>
                    <input value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                  <div className="scene-col scene-col-sm">
                    <label>类别</label>
                    <select value={type} onChange={(e) => setType(e.target.value as EntityType)}>
                      {ENTITY_TYPES.map((t) => (
                        <option key={t} value={t}>{ENTITY_LABEL[t]}</option>
                      ))}
                    </select>
                  </div>
                  <div className="scene-col scene-col-xs">
                    <label>图标</label></div>
                </div>

                <div className="scene-field">
                  <label>一句话设定 / 简介</label>
                  <input value={description} onChange={(e) => setDescription(e.target.value)} />
                </div>

                <div className="scene-field scene-field-row">
                  <div className="scene-col">
                    <label>身份格言 / 标语</label>
                    <input value={motto} onChange={(e) => setMotto(e.target.value)} placeholder="可选" />
                  </div>
                  <div className="scene-col">
                    <label>编号</label>
                    <input value={serial} onChange={(e) => setSerial(e.target.value)} placeholder="如 ID-2024-001" />
                  </div>
                </div>

                <div className="scene-field">
                  <label>图片图注（可选）</label>
                  <input value={caption} onChange={(e) => setCaption(e.target.value)} />
                </div>

                <div className="scene-field">
                  <label>属性字段</label>
                  <div className="scene-fields">
                    {fields.map((f, i) => (
                      <div className="scene-field-row2" key={i}>
                        <input
                          className="scene-key"
                          value={f.key}
                          placeholder="键（如 阵营）"
                          onChange={(e) => updateField(i, { key: e.target.value })}
                        />
                        <input
                          className="scene-val"
                          value={f.value}
                          placeholder="值"
                          onChange={(e) => updateField(i, { value: e.target.value })}
                        />
                        <button className="scene-del" onClick={() => removeField(i)} title="删除">×</button>
                      </div>
                    ))}
                    <button className="scene-add" onClick={addField}>＋ 添加字段</button>
                  </div>
                </div>

                <button className="mf-export-btn mf-export-primary scene-submit" onClick={toProposal}>
                  加入提案队列（待你采纳）
                </button>
              </div>
            )}
          </div>

          {/* 右：实时卡片预览（文字 + 图片） */}
          <div className="scene-right">
            <div className="scene-preview-title">实时卡片预览（idCard 模板）</div>
            <div className="scene-preview-scroll">
              {previewEntity ? (
                <MaterialPreview
                  token={token}
                  header={worldName}
                  template={ID_CARD as MaterialTemplate}
                  ctx={ctx}
                  scale={1.5}
                />
              ) : (
                <div className="scene-preview-empty">
                  {image ? '点击「AI 设卡」生成卡片…' : '上传图片后将在此预览文字 + 图片卡片'}
                </div>
              )}
            </div>
            <div className="scene-preview-note">
              预览复用「证件 / ID 卡」模板：图片取自上传图，文字取自上方字段；采纳提案后可在「可视化编辑器」中用任意模板重渲染该实体。
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
