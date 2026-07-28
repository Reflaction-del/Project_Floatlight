import { useState, useMemo, useEffect, useRef } from 'react';
import { useWorldStore } from '../../store/worldStore';
import { useUIStore } from '../../store/uiStore';
import { usePromptStore } from '../../store/promptStore';
import type { EntityType, RelationType, TimelineEvent, EntityField } from '../../types';
import { ENTITY_TEMPLATES, ENTITY_LABEL, RELATION_LABEL } from '../../types';
import { getCurrentModel, chatOnce } from '../../utils/ai';
import { buildConstraintPrompt, entityAsRetrieved } from '../../utils/worldContext';

const ENTITY_TYPES = ENTITY_TEMPLATES.map((t) => t.type);

/** 从 AI 回复中解析「字段名 → 建议值」的 JSON 对象（围栏 ```json ... ```）。 */
function parseSuggestions(text: string): { label: string; value: string }[] {
  const m = text.match(/```json\s*([\s\S]*?)```/i);
  if (!m) return [];
  try {
    const obj = JSON.parse(m[1]);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      return Object.entries(obj).map(([label, value]) => ({ label, value: typeof value === 'string' ? value : JSON.stringify(value) }));
    }
  } catch { /* 解析失败则忽略，仅展示纯文本 */ }
  return [];
}

function templateFields(type: EntityType): EntityField[] {
  const tpl = ENTITY_TEMPLATES.find((t) => t.type === type);
  return (tpl?.fields ?? []).map((f) => ({ label: f.label, value: '', kind: f.kind, entityType: f.entityType }));
}

export function EntityEditor({ entityId }: { entityId: string }) {
  const entity = useWorldStore((s) => (s.worldsData[s.current]?.entities ?? []).find((e) => e.id === entityId));
  const nameRef = useRef<HTMLInputElement>(null);
  // 修复：新建/打开实体后输入框偶有无法输入（autoFocus 在 Electron 窗口焦点竞态下失效，
  // 表现为「重进/切回应用就好了」）。用 ref + 延迟强制聚焦，保证编辑器打开后名称框必定获得焦点。
  useEffect(() => {
    if (!entity) return;
    const t = window.setTimeout(() => nameRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [entity?.id]);
  const entities = useWorldStore((s) => s.worldsData[s.current]?.entities ?? []);
  const relations = useWorldStore((s) => s.worldsData[s.current]?.relations ?? []);
  const updateEntity = useWorldStore((s) => s.updateEntity);
  const deleteEntity = useWorldStore((s) => s.deleteEntity);
  const addRelation = useWorldStore((s) => s.addRelation);
  const removeRelation = useWorldStore((s) => s.removeRelation);
  const addEntityComment = useWorldStore((s) => s.addEntityComment);
  const saveEntityVersion = useWorldStore((s) => s.saveEntityVersion);
  const restoreEntityVersion = useWorldStore((s) => s.restoreEntityVersion);
  const addTimelineEvent = useWorldStore((s) => s.addTimelineEvent);
  const updateTimelineEvent = useWorldStore((s) => s.updateTimelineEvent);
  const deleteTimelineEvent = useWorldStore((s) => s.deleteTimelineEvent);
  const timelines = useWorldStore((s) => s.worldsData[s.current]?.timelines ?? []);
  const activeTimelineId = useWorldStore((s) => s.worldsData[s.current]?.activeTimelineId ?? '');
  const addEntityImage = useWorldStore((s) => s.addEntityImage);
  const removeEntityImage = useWorldStore((s) => s.removeEntityImage);
  const setEntityCoverImage = useWorldStore((s) => s.setEntityCoverImage);
  const openTab = useUIStore((s) => s.openTab);
  const closeTabsByRef = useUIStore((s) => s.closeTabsByRef);
  const prompt = usePromptStore((s) => s.open);

  const [relTarget, setRelTarget] = useState('');
  const [relType, setRelType] = useState<RelationType>('belongs');
  const [relLabel, setRelLabel] = useState('');
  const [tagInput, setTagInput] = useState('');

  const myRelations = useMemo(
    () => relations.filter((r) => r.source === entityId || r.target === entityId),
    [relations, entityId],
  );
  const candidates = useMemo(() => entities.filter((e) => e.id !== entityId), [entities, entityId]);
  const coverImage = useMemo(() => {
    const images = entity?.images ?? [];
    if (images.length === 0) return null;
    return images.find((i) => i.id === entity?.coverImageId) ?? images[0];
  }, [entity?.images, entity?.coverImageId]);

  if (!entity) {
    return (
      <div className="editor-scroll">
        <div className="editor-wrap">
          <div className="placeholder-view" style={{ minHeight: 300 }}>
            <div className="big">实体</div>
            <div>未找到该实体，可能已被删除。</div>
          </div>
        </div>
      </div>
    );
  }

  const setFieldValue = (idx: number, value: string) => {
    const fields = entity.fields.map((f, i) => (i === idx ? { ...f, value } : f));
    updateEntity(entity.id, { fields });
  };
  const setFieldRef = (idx: number, refId: string) => {
    const fields = entity.fields.map((f, i) => (i === idx ? { ...f, value: refId } : f));
    updateEntity(entity.id, { fields });
  };

  const addTag = (raw: string) => {
    const next = raw.split(/[，,]/).map((t) => t.trim()).filter(Boolean);
    if (next.length === 0) return;
    const set = new Set(entity.tags);
    next.forEach((t) => set.add(t));
    updateEntity(entity.id, { tags: [...set] });
    setTagInput('');
  };
  const removeTag = (tag: string) => {
    updateEntity(entity.id, { tags: entity.tags.filter((t) => t !== tag) });
  };
  const updateField = (idx: number, patch: Partial<EntityField>) => {
    const fields = entity.fields.map((f, i) => (i === idx ? { ...f, ...patch } : f));
    updateEntity(entity.id, { fields });
  };
  const setCustomValue = (idx: number, key: 'label' | 'value', val: string) => {
    const custom = entity.custom.map((c, i) => (i === idx ? { ...c, [key]: val } : c));
    updateEntity(entity.id, { custom });
  };
  const addCustom = () => updateEntity(entity.id, { custom: [...entity.custom, { label: '新字段', value: '' }] });
  const removeCustom = (idx: number) => updateEntity(entity.id, { custom: entity.custom.filter((_, i) => i !== idx) });

  const onChangeType = (type: EntityType) => {
    if (type === entity.type) return;
    if (!window.confirm(`切换为「${ENTITY_LABEL[type]}」会用该类型模板字段覆盖当前结构化字段，是否继续？`)) return;
    updateEntity(entity.id, { type, fields: templateFields(type) });
  };

  const onAddRelation = () => {
    if (!relTarget) return;
    addRelation(entity.id, relTarget, relType, relLabel.trim() || undefined);
    setRelLabel('');
  };

  const onDelete = () => {
    if (window.confirm(`删除实体「${entity.name}」？其相关关系也会一并移除。`)) {
      closeTabsByRef('entity', entity.id);
      deleteEntity(entity.id);
    }
  };

  const myTimelineEvents = useMemo(() => {
    return timelines.flatMap((tl) =>
      tl.events
        .filter((e) => e.entityId === entity.id)
        .map((e) => ({ ...e, timelineId: tl.id, timelineName: tl.name }))
    );
  }, [timelines, entityId]);

  const onAddTimelineEvent = async () => {
    const tl = timelines.find((t) => t.id === activeTimelineId) ?? timelines[0];
    if (!tl) { alert('当前世界没有时间轴，请先创建一个。'); return; }
    const v = await prompt({
      title: `添加「${entity.name}」的时间线节点`,
      fields: [
        { name: 'label', label: '节点名称', default: entity.name },
        { name: 'year', label: '年份', type: 'number', default: '0' },
        { name: 'impact', label: '影响力 (0-100)', type: 'number', default: '50' },
        { name: 'note', label: '备注（可选）' },
      ],
    });
    if (!v?.label) return;
    const year = Number(v.year);
    if (!Number.isFinite(year)) return;
    addTimelineEvent(tl.id, {
      label: v.label.trim(),
      year,
      impact: Math.max(0, Math.min(100, Number(v.impact) || 50)),
      note: v.note || undefined,
      color: '#8b5cf6',
      entityId: entity.id,
    });
  };

  const onEditTimelineEvent = async (event: TimelineEvent & { timelineId: string }) => {
    const v = await prompt({
      title: '编辑时间线节点',
      fields: [
        { name: 'label', label: '节点名称', default: event.label },
        { name: 'year', label: '年份', type: 'number', default: String(event.year) },
        { name: 'impact', label: '影响力 (0-100)', type: 'number', default: String(event.impact ?? 50) },
        { name: 'note', label: '备注（可选）', default: event.note || '' },
      ],
    });
    if (!v?.label) return;
    const year = Number(v.year);
    if (!Number.isFinite(year)) return;
    updateTimelineEvent(event.timelineId, event.id, {
      label: v.label.trim(),
      year,
      impact: Math.max(0, Math.min(100, Number(v.impact) || 50)),
      note: v.note || undefined,
    });
  };

  const onDeleteTimelineEvent = (timelineId: string, eventId: string) => {
    if (window.confirm('删除该时间线节点？时间轴上的对应事件会被移除。')) {
      deleteTimelineEvent(timelineId, eventId);
    }
  };

  const nameOf = (id: string) => entities.find((e) => e.id === id)?.name ?? '(未知)';

  const onAddImage = async () => {
    const dataUrl = await window.api?.openImage?.();
    if (dataUrl) addEntityImage(entity.id, dataUrl);
  };

  const [commentText, setCommentText] = useState('');
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState(
    '请基于世界观已有设定，补全该实体的关键缺失字段、给出合理的背景延展，并指出与其它设定可能的冲突。用要点列出。',
  );
  const [aiResult, setAiResult] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const hasModel = !!getCurrentModel();

  const runAI = async () => {
    const model = getCurrentModel();
    if (!model) { setAiResult('（未配置 AI 模型）'); return; }
    setAiLoading(true);
    setAiResult('');
    const constraint = buildConstraintPrompt({ entities, relations }, [entityAsRetrieved(entity, relations)], '');
    const instruction =
      '\n\n另外，请在回答末尾用 ```json 围栏单独输出一个对象，键为「字段名」、值为该字段建议填充的文本内容（针对本实体已有结构化字段或合理的自定义字段），例如：\n```json\n{"外貌": "金发碧眼的中年骑士", "性格": "外冷内热"}\n```\n只输出该 JSON 对象，不要额外解释。';
    const userContent = `${constraint}\n\n请针对实体「${entity.name}」${aiPrompt.trim()}${instruction}`;
    try {
      const r = await chatOnce(model, [{ role: 'user', content: userContent }], { feature: 'entity-ai' });
      setAiResult(r || '（模型返回为空）');
    } catch (e: any) {
      setAiResult('（' + (e.message || String(e)) + '）');
    } finally {
      setAiLoading(false);
    }
  };

  // 解析 AI 回复中的字段建议，供「应用到字段」一键填充
  const aiSuggestions = useMemo(() => parseSuggestions(aiResult), [aiResult]);

  const applySuggestion = (label: string, value: string) => {
    const target = label.trim();
    const lower = target.toLowerCase();
    const matchLabel = (l: string) => {
      const s = l.toLowerCase();
      return s === lower || s.includes(lower) || lower.includes(s);
    };
    const fi = entity.fields.findIndex((f) => matchLabel(f.label));
    if (fi >= 0) { setFieldValue(fi, value); return; }
    const ci = entity.custom.findIndex((c) => matchLabel(c.label));
    if (ci >= 0) { setCustomValue(ci, 'value', value); return; }
    // 未匹配到现有字段：新增一条自定义字段
    updateEntity(entity.id, { custom: [...entity.custom, { label: target, value }] });
  };

  return (
    <div className="editor-scroll">
      <div className="editor-wrap entity-editor">
        <div className="entity-header">
          <input
            ref={nameRef}
            value={entity.name}
            onChange={(e) => updateEntity(entity.id, { name: e.target.value })}
            placeholder="实体名称"
            className="entity-name-input"
          />
          <select value={entity.type} onChange={(e) => onChangeType(e.target.value as EntityType)} className="entity-type-select" title="实体类型">
            {ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>{ENTITY_LABEL[t]}</option>
            ))}
          </select>
          {coverImage && (
            <div className="entity-cover-thumb" title="当前封面">
              <img src={coverImage.dataUrl} alt="封面" />
            </div>
          )}
          <button className="mode-btn danger" style={{ marginLeft: 'auto' }} onClick={onDelete}>删除</button>
        </div>
        <p className="tip entity-meta">结构化录入（M1）· 类型「{ENTITY_LABEL[entity.type]}」· 更新于 {new Date(entity.updatedAt).toLocaleString('zh-CN')}</p>

        <div className="entity-cards">
          <div className="entity-section">
            <div className="entity-section-title">插图</div>
            <p className="tip">添加多张插图，实体库卡片会以半透明背景展示当前封面。</p>
            {(entity.images ?? []).length === 0 && <div className="tip">暂无插图。</div>}
            <div className="entity-images">
              {(entity.images ?? []).map((img) => (
                <div
                  key={img.id}
                  className={'entity-image-item' + (img.id === (entity.coverImageId ?? entity.images?.[0]?.id) ? ' active' : '')}
                  onClick={() => setEntityCoverImage(entity.id, img.id)}
                  title={img.name}
                >
                  <img src={img.dataUrl} alt={img.name} />
                  <div className="entity-image-actions">
                    <button
                      className="mode-btn"
                      onClick={(e) => { e.stopPropagation(); setEntityCoverImage(entity.id, img.id); }}
                      title="设为封面"
                    >
                      封面
                    </button>
                    <button
                      className="entity-field-del"
                      onClick={(e) => { e.stopPropagation(); if (window.confirm(`删除插图「${img.name}」？`)) removeEntityImage(entity.id, img.id); }}
                      title="删除"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <button className="mode-btn active" onClick={onAddImage}>＋ 添加插图</button>
            </div>
          </div>

          <div className="entity-section">
            <div className="entity-section-title">结构化字段</div>
          {entity.fields.length === 0 && <div className="tip">该类型暂无预置字段，可在下方添加自定义字段。</div>}
          {entity.fields.map((f, i) => {
            const isEntityRef = f.kind === 'entity';
            const refCandidates = isEntityRef
              ? entities.filter((e) => e.id !== entity.id && (f.entityType?.length ? f.entityType.includes(e.type) : true))
              : [];
            return (
              <div key={i} className="entity-field-row">
                <label className="entity-field-label">{f.label}</label>
                {isEntityRef ? (
                  <select
                    value={f.value || ''}
                    onChange={(e) => setFieldRef(i, e.target.value)}
                    className="entity-field-input entity-field-select"
                    title={`选择关联的${f.entityType?.map((t) => ENTITY_LABEL[t]).join('/') ?? '实体'}`}
                  >
                    <option value="">{f.entityType?.length ? `无所属${f.entityType.map((t) => ENTITY_LABEL[t]).join('/')}` : '无所属'}</option>
                    {refCandidates.map((e) => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={f.value}
                    onChange={(e) => setFieldValue(i, e.target.value)}
                    placeholder={`填写${f.label}`}
                    className="entity-field-input"
                  />
                )}
              </div>
            );
          })}
          <button
            className="mode-btn"
            style={{ marginTop: 6 }}
            onClick={() => {
              const label = window.prompt('新字段名称：', '')?.trim();
              if (label) updateEntity(entity.id, { fields: [...entity.fields, { label, value: '' }] });
            }}
          >＋ 加字段</button>
        </div>

        <div className="entity-section">
          <div className="entity-section-title">自定义字段</div>
          {entity.custom.length === 0 && <div className="tip">暂无自定义字段。</div>}
          {entity.custom.map((c, i) => (
            <div key={i} className="entity-field-row">
              <input
                value={c.label}
                onChange={(e) => setCustomValue(i, 'label', e.target.value)}
                placeholder="字段名"
                className="entity-field-label-input"
              />
              <input
                value={c.value}
                onChange={(e) => setCustomValue(i, 'value', e.target.value)}
                placeholder="字段值"
                className="entity-field-input"
              />
              <button className="entity-field-del" onClick={() => removeCustom(i)} title="删除该字段">✕</button>
            </div>
          ))}
          <button className="mode-btn" style={{ marginTop: 6 }} onClick={addCustom}>＋ 加自定义字段</button>
        </div>

        <div className="entity-section">
          <div className="entity-section-title">标签</div>
          <input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(tagInput); } }}
            onBlur={() => tagInput.trim() && addTag(tagInput)}
            placeholder="输入标签后回车添加，如：主角、反派"
            className="entity-tags-input"
          />
          {entity.tags.length > 0 && (
            <div className="entity-tags">
              {entity.tags.map((t, i) => (
                <span key={i} className="entity-tag" title="点击删除该标签" onClick={() => removeTag(t)}>
                  {t}<span className="entity-tag-x">×</span>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="entity-section">
          <div className="entity-section-title">备注</div>
          <textarea
            value={entity.note ?? ''}
            onChange={(e) => updateEntity(entity.id, { note: e.target.value })}
            placeholder="自由文本备注……"
            className="entity-note"
            rows={3}
          />
        </div>

        <div className="entity-section">
          <div className="entity-section-title">关系（M2）</div>
          {myRelations.length === 0 && <div className="tip">暂无关系连线。</div>}
          <div className="entity-rels">
            {myRelations.map((r) => {
              const isSource = r.source === entity.id;
              const otherId = isSource ? r.target : r.source;
              return (
                <div key={r.id} className="entity-rel">
                  <span className={'entity-rel-dir' + (isSource ? '' : ' reverse')}>
                    {isSource ? '→' : '←'}
                  </span>
                  <span className="entity-rel-type">{RELATION_LABEL[r.type]}{r.label ? `·${r.label}` : ''}</span>
                  <button className="entity-rel-target" onClick={() => openTab({ title: nameOf(otherId), icon: entities.find((e) => e.id === otherId)?.type ?? 'character', kind: 'entity', ref: otherId })}>
                    {nameOf(otherId)}
                  </button>
                  <button className="entity-rel-del" onClick={() => removeRelation(r.id)} title="删除该关系">✕</button>
                </div>
              );
            })}
          </div>

          <div className="entity-rel-add">
            <select value={relTarget} onChange={(e) => setRelTarget(e.target.value)} className="entity-rel-select">
              <option value="">选择关联实体…</option>
              {candidates.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
            <select value={relType} onChange={(e) => setRelType(e.target.value as RelationType)} className="entity-rel-select">
              {Object.entries(RELATION_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <input
              value={relLabel}
              onChange={(e) => setRelLabel(e.target.value)}
              placeholder="关系说明（可选）"
              className="entity-rel-label"
            />
            <button className="mode-btn active" onClick={onAddRelation} disabled={!relTarget}>＋ 连线</button>
          </div>
          <p className="tip">提示：亲缘 / 敌对为对称关系，建议双向都连，否则一致性检查会提示「对称关系缺失」。</p>
        </div>

        <div className="entity-section">
          <div className="entity-section-title">时间线节点</div>
          <p className="tip">一个实体可拥有多个时间线节点，用于表示事件转折点、人物成长阶段、势力发展历程等。</p>
          {myTimelineEvents.length === 0 && <div className="tip">暂无时间线节点。</div>}
          <div className="entity-timeline-events">
            {myTimelineEvents.map((e) => (
              <div key={e.id} className="entity-timeline-event">
                <div className="entity-timeline-info">
                  <span className="entity-timeline-year">纪元 {e.year}</span>
                  <span className="entity-timeline-name">{e.label}</span>
                  <span className="entity-timeline-impact" title="影响力">● {e.impact ?? 50}</span>
                </div>
                {e.note && <div className="entity-timeline-note">{e.note}</div>}
                <div className="entity-timeline-actions">
                  <button className="mode-btn" onClick={() => onEditTimelineEvent(e)}>编辑</button>
                  <button className="mode-btn" onClick={() => openTab({ title: e.timelineName, icon: '', kind: 'timeline', ref: e.timelineId })}>打开时间轴</button>
                  <button className="entity-field-del" onClick={() => onDeleteTimelineEvent(e.timelineId, e.id)} title="删除">✕</button>
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <button className="mode-btn active" onClick={onAddTimelineEvent}>＋ 添加时间线节点</button>
          </div>
        </div>

        <div className="entity-section">
          <div className="entity-section-title">评论（M7-3）</div>
          <div className="entity-comments">
            {(entity.comments ?? []).length === 0 && <div className="tip">暂无评论。</div>}
            {(entity.comments ?? []).map((c) => (
              <div key={c.id} className="entity-comment">
                <div className="entity-comment-head">
                  <span className="entity-comment-author">{c.author}</span>
                  <span className="entity-comment-ts">{new Date(c.ts).toLocaleString('zh-CN')}</span>
                </div>
                <div className="entity-comment-body">{c.content}</div>
              </div>
            ))}
          </div>
          <div className="entity-comment-add">
            <input
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="添加评论…（如：这个角色动机可以再矛盾一点）"
              className="entity-comment-input"
              onKeyDown={(e) => { if (e.key === 'Enter' && commentText.trim()) { addEntityComment(entity.id, '我', commentText.trim()); setCommentText(''); } }}
            />
            <button className="mode-btn active" onClick={() => { if (commentText.trim()) { addEntityComment(entity.id, '我', commentText.trim()); setCommentText(''); } }}>发送</button>
          </div>
        </div>

        <div className="entity-section">
          <div className="entity-section-title">
            版本历史（M7-3）
            <button className="mode-btn" style={{ marginLeft: 'auto', fontSize: 11 }} onClick={() => saveEntityVersion(entity.id)}>＋ 保存当前为版本</button>
          </div>
          <p className="tip">手动保存快照后可随时回滚到该版本（仅名称/字段/标签/备注等核心内容）。</p>
          <div className="entity-versions">
            {(entity.versions ?? []).length === 0 && <div className="tip">暂无版本快照。</div>}
            {(entity.versions ?? []).slice().reverse().map((v) => (
              <div key={v.version} className="entity-version">
                <span className="entity-version-no">v{v.version}</span>
                <span className="entity-version-ts">{new Date(v.ts).toLocaleString('zh-CN')}</span>
                <span className="entity-version-name">{v.snapshot.name}</span>
                <button className="mode-btn" onClick={() => { if (window.confirm(`回滚到 v${v.version}（"${v.snapshot.name}"）？当前未保存的修改会被覆盖。`)) restoreEntityVersion(entity.id, v.version); }}>回滚</button>
              </div>
            ))}
          </div>
        </div>

        <div className="entity-section">
          <div className="entity-section-title">
            AI 补全建议
            <button className="mode-btn" style={{ marginLeft: 'auto', fontSize: 11 }} onClick={() => setAiOpen((v) => !v)}>
              {aiOpen ? '收起' : '展开'}
            </button>
          </div>
          {aiOpen && (
            <div className="entity-ai">
              <p className="tip">基于当前实体与世界观已有设定，让 AI 补全缺失字段、延展背景并指出潜在冲突。</p>
              <textarea
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                className="entity-ai-prompt"
                rows={3}
              />
              <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                <button className="mode-btn active" onClick={runAI} disabled={aiLoading || !hasModel}>
                  {aiLoading ? '生成中…' : '生成建议'}
                </button>
                {aiResult && (
                  <button className="mode-btn" onClick={() => navigator.clipboard?.writeText(aiResult)}>复制</button>
                )}
              </div>
              {!hasModel && <p className="tip" style={{ color: 'var(--danger)' }}>尚未配置 AI 模型，请到 设置 → 大模型接入 添加。</p>}
              {aiResult && <pre className="entity-ai-result">{aiResult}</pre>}
              {aiSuggestions.length > 0 && (
                <div className="entity-ai-suggest">
                  <div className="entity-ai-suggest-head">建议可应用到字段：</div>
                  {aiSuggestions.map((s, i) => (
                    <div key={i} className="entity-ai-suggest-row">
                      <span className="entity-ai-suggest-label">{s.label}</span>
                      <span className="entity-ai-suggest-value">{s.value}</span>
                      <button className="mode-btn" onClick={() => applySuggestion(s.label, s.value)} title="填充到对应字段">应用到字段</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}
