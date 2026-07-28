import { useMemo, useState } from 'react';
import { useWorldStore } from '../../store/worldStore';
import { storage } from '../../storage';
import { useUIStore } from '../../store/uiStore';
import { ENTITY_LABEL, type EntityType } from '../../types';
import {
  buildSharePayload,
  buildShareHTML,
  detectConflicts,
  resolveMerge,
  extractShareEntities,
  type MergeResolution,
  type MergeStrategy,
} from '../../utils/share';

const TYPE_ORDER: EntityType[] = ['character', 'faction', 'location', 'event', 'rule'];

export function SharePanel() {
  const current = useWorldStore((s) => s.current);
  const wd = useWorldStore((s) => s.worldsData[s.current]);
  const mergeImported = useWorldStore((s) => s.mergeImported);
  const openTab = useUIStore((s) => s.openTab);

  const entities = wd?.entities ?? [];
  const relations = wd?.relations ?? [];
  const docs = wd?.docs ?? [];

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [docSelected, setDocSelected] = useState<Set<string>>(new Set());
  const [onlyFields, setOnlyFields] = useState(false);
  const [fieldAllow, setFieldAllow] = useState<Set<string>>(new Set());
  const [expire, setExpire] = useState('');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');

  // 合并导入状态
  const [importConflicts, setImportConflicts] = useState<
    ReturnType<typeof detectConflicts> | null
  >(null);
  const [pendingImport, setPendingImport] = useState<{ entities: any[]; relations: any[] } | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, MergeStrategy>>({});

  const grouped = useMemo(() => {
    const m = new Map<EntityType, typeof entities>();
    TYPE_ORDER.forEach((t) => m.set(t, []));
    entities.forEach((e) => m.get(e.type)?.push(e));
    return m;
  }, [entities]);

  const fieldUniverse = useMemo(() => {
    const s = new Set<string>();
    entities.filter((e) => selected.has(e.id)).forEach((e) => {
      e.fields.forEach((f) => s.add(f.label));
      e.custom.forEach((c) => s.add(c.label));
    });
    return Array.from(s);
  }, [entities, selected]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const toggleType = (t: EntityType) => {
    const ids = (grouped.get(t) ?? []).map((e) => e.id);
    const allSel = ids.every((i) => selected.has(i));
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((i) => (allSel ? next.delete(i) : next.add(i)));
      return next;
    });
  };

  const download = (name: string, content: string, mime: string) => {
    if (storage.isNative()) {
      storage.exportFile(name, content);
    } else {
      const blob = new Blob([content], { type: mime });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
    }
  };

  const doExport = (asHtml: boolean) => {
    if (selected.size === 0) {
      setMsg('请先勾选要分享的实体');
      return;
    }
    const opts = {
      entityIds: Array.from(selected),
      docIds: Array.from(docSelected),
      fieldWhitelist: onlyFields ? Array.from(fieldAllow) : null,
      expireAt: expire ? new Date(expire + 'T23:59:59').getTime() : 0,
      title: title.trim() || undefined,
      note: note.trim() || undefined,
    };
    const payload = buildSharePayload(current, entities, relations, docs, opts);
    const stamp = new Date().toISOString().slice(0, 10);
    if (asHtml) {
      const html = buildShareHTML(payload);
      download(`分享_${current}_${stamp}.html`, html, 'text/html');
      setMsg(`✓ 已导出独立 HTML 查看器（${payload.entities.length} 个实体）。接收方双击即可在浏览器查看，无需安装软件。`);
    } else {
      download(`分享_${current}_${stamp}.json`, JSON.stringify(payload, null, 2), 'application/json');
      setMsg(`✓ 已导出范围可控的分享快照 JSON（${payload.entities.length} 个实体 / ${payload.relations.length} 条关系）。`);
    }
  };

  const startImport = async () => {
    let content: string | undefined;
    let fname = '';
    if (storage.isNative()) {
      const picked = await storage.pickImport();
      if (!picked) return;
      content = picked.content;
      fname = picked.name;
    } else {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      await new Promise<void>((res) => {
        input.onchange = () => res();
        input.click();
      });
      const file = input.files?.[0];
      if (!file) return;
      content = await file.text();
      fname = file.name;
    }
    const parsed = extractShareEntities(content!);
    if (!parsed) {
      setMsg('✗ 无法识别文件：请选择浮光分享快照(.json)或世界观备份(.json)');
      return;
    }
    const conflicts = detectConflicts(entities, parsed.entities);
    if (conflicts.length === 0) {
      mergeImported(parsed.entities, parsed.relations);
      setMsg(`✓ 已合并导入「${fname}」：${parsed.entities.length} 个实体（无冲突）。`);
      setImportConflicts(null);
      setPendingImport(null);
    } else {
      const init: Record<string, MergeStrategy> = {};
      conflicts.forEach((c) => (init[c.importedId] = 'keep'));
      setResolutions(init);
      setImportConflicts(conflicts);
      setPendingImport({ entities: parsed.entities, relations: parsed.relations });
      setMsg(`检测到 ${conflicts.length} 处冲突，请逐条选择处理方式。`);
    }
  };

  const applyMerge = () => {
    if (!pendingImport || !importConflicts) return;
    const res: MergeResolution[] = importConflicts.map((c) => ({
      conflict: c,
      strategy: resolutions[c.importedId] || 'keep',
    }));
    const { entities: newEnt, relations: newRel } = resolveMerge(
      entities,
      pendingImport.entities,
      pendingImport.relations,
      res,
      (oldId) => `en-imp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    );
    mergeImported(newEnt, newRel);
    setMsg(`✓ 已按决议合并导入：${newEnt.length} 个实体落库。`);
    setImportConflicts(null);
    setPendingImport(null);
  };

  return (
    <div className="editor-scroll">
      <div className="editor-wrap" style={{ maxWidth: 880 }}>
        <h2>协作与分享</h2>
        <p className="tip">
          纯本地、无后端版本：可<b>勾选部分设定导出为范围可控的分享快照</b>（JSON 或独立 HTML 查看器），
          也可把他人分享的文件<b>合并导入</b>到当前世界（冲突可视化选择）。
          实时多人协同（M7-2）需后端与账号体系支撑，本构建以「合并导入」作为本地替代。
        </p>

        {/* 选择范围 */}
        <section className="set-section">
          <h3>① 选择要分享的设定</h3>
          <div className="share-types">
            {TYPE_ORDER.map((t) => {
              const list = grouped.get(t) ?? [];
              if (!list.length) return null;
              const allSel = list.every((e) => selected.has(e.id));
              return (
                <div key={t} className="share-type-block">
                  <div className="share-type-head">
                    <label className="share-check">
                      <input type="checkbox" checked={allSel} onChange={() => toggleType(t)} />
                      <span>{ENTITY_LABEL[t]}（{list.length}）</span>
                    </label>
                  </div>
                  <div className="share-type-items">
                    {list.map((e) => (
                      <label key={e.id} className="share-check share-item">
                        <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggle(e.id)} />
                        <span>{e.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="tip" style={{ marginTop: 8 }}>已选 {selected.size} 个实体{onlyFields ? '（仅部分字段）' : ''}。</div>

          <div style={{ marginTop: 10 }}>
            <label className="share-check">
              <input type="checkbox" checked={onlyFields} onChange={(e) => { setOnlyFields(e.target.checked); if (e.target.checked && fieldAllow.size === 0) setFieldAllow(new Set(fieldUniverse)); }} />
              <span>仅分享选定字段（脱敏用，未勾选的字段值不导出）</span>
            </label>
            {onlyFields && (
              <div className="share-field-list">
                {fieldUniverse.length === 0 && <span className="tip">勾选实体后可在此选择要导出的字段。</span>}
                {fieldUniverse.map((f) => (
                  <label key={f} className="share-check share-field">
                    <input type="checkbox" checked={fieldAllow.has(f)} onChange={() => setFieldAllow((p) => { const n = new Set(p); n.has(f) ? n.delete(f) : n.add(f); return n; })} />
                    <span>{f}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* 分享选项 */}
        <section className="set-section">
          <h3>② 分享选项</h3>
          <div className="share-opts">
            <label className="modal-field" style={{ flex: '1 1 200px' }}><span>分享标题</span><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如：赤霄纪元·核心设定" /></label>
            <label className="modal-field" style={{ flex: '1 1 160px' }}><span>有效期至（可选）</span><input type="date" value={expire} onChange={(e) => setExpire(e.target.value)} /></label>
          </div>
          <label className="modal-field" style={{ marginTop: 8 }}><span>说明</span><textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="给接收方的一句话说明（会显示在 HTML 查看器顶部）" rows={2} /></label>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button className="mode-btn active" onClick={() => doExport(false)}>导出分享快照 (JSON)</button>
            <button className="mode-btn" onClick={() => doExport(true)}>导出独立查看器 (HTML)</button>
          </div>
        </section>

        {/* 合并导入 */}
        <section className="set-section">
          <h3>③ 合并导入（分享 / 世界备份）</h3>
          <p className="tip">把他人分享的快照或世界备份合并进当前世界。同名/同 ID 的实体会触发冲突，需要你逐条决定「保留 / 覆盖 / 重命名导入」。</p>
          <button className="mode-btn" onClick={startImport}>选择文件并合并导入</button>

          {importConflicts && importConflicts.length > 0 && (
            <div className="merge-box">
              <div className="merge-title">冲突处理（{importConflicts.length} 处）</div>
              {importConflicts.map((c) => (
                <div key={c.importedId} className="merge-row">
                  <div className="merge-name">{c.name} <span className="merge-kind">{c.kind === 'id' ? 'ID 重复' : '名称重复'}</span></div>
                  <div className="merge-strats">
                    {(['keep', 'replace', 'rename'] as MergeStrategy[]).map((s) => (
                      <button key={s} className={'mode-btn' + (resolutions[c.importedId] === s ? ' active' : '')} onClick={() => setResolutions((p) => ({ ...p, [c.importedId]: s }))}>
                        {s === 'keep' ? '保留本地' : s === 'replace' ? '用导入覆盖' : '重命名导入'}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <button className="mode-btn active" style={{ marginTop: 10 }} onClick={applyMerge}>✓ 应用并合并</button>
            </div>
          )}
        </section>

        {msg && <div className="tip" style={{ marginTop: 12, color: msg.startsWith('✗') ? 'var(--danger)' : 'var(--accent)' }}>{msg}</div>}
      </div>
    </div>
  );
}
