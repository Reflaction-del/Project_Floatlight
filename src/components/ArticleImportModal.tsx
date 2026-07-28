// ============================================================
// 文章导入与抽取弹窗（Phase 1a · 功能1）
// ------------------------------------------------------------
// 用户粘贴 / 上传 txt·md 正文，调用模型抽取实体与关系，
// 预览后「加入提案队列」——所有抽取结果先进入统一提案队列，
// 由用户在提案中心逐条采纳。
// ============================================================

import { useState, useRef, useMemo, useCallback } from 'react';
import { useWorldStore } from '../store/worldStore';
import { useUIStore } from '../store/uiStore';
import { useWorldviewStore } from '../store/worldviewStore';
import { extractFromArticle, type ExtractResult } from '../features/ai/articleExtract';
import { ENTITY_LABEL, RELATION_LABEL } from '../types';

export function ArticleImportModal({ onClose }: { onClose: () => void }) {
  const worldview = useWorldviewStore();
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractResult | null>(null);
  const [sent, setSent] = useState<{ added: number; dup: number; rel: number; relUnresolved: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result ?? ''));
    reader.readAsText(f);
  };

  const run = async () => {
    const t = text.trim();
    if (!t) { setError('请先粘贴文章正文，或上传 .txt / .md 文件。'); return; }
    setBusy(true);
    setError(null);
    setResult(null);
    setSent(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const worldName = worldview.worlds.find((w) => w.name === worldview.current)?.name ?? '世界观';
      const cur = useWorldStore.getState().current;
      const wd = useWorldStore.getState().worldsData[cur];
      // 传入当前世界已有实体/关系，供抽取时召回「相关已有实体」做去重（只取 topK，不灌全库）
      const res = await extractFromArticle(t, worldName, ctrl.signal, 4096, {
        entities: wd?.entities ?? [],
        relations: wd?.relations ?? [],
      });
      setResult(res);
    } catch (err: any) {
      if (err?.name === 'AbortError' || err === '手动终止') setError('已取消抽取。');
      else setError('抽取失败：' + (err?.message || String(err)));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const stop = () => { abortRef.current?.abort(); };

  const addToQueue = useCallback(() => {
    if (!result) return;
    const wd = useWorldStore.getState().worldsData[useWorldStore.getState().current];
    const existing = wd?.entities ?? [];
    const nameToId = new Map<string, string>();
    const idToName = new Map<string, string>();
    const existingNameSet = new Set<string>();
    for (const e of existing) {
      const k = e.name.trim().toLowerCase();
      nameToId.set(k, e.id);
      idToName.set(e.id, e.name);
      existingNameSet.add(k);
    }
    const addProposal = useWorldStore.getState().addProposal;
    const existingIdSet = new Set(existing.map((e) => e.id));
    let added = 0, dup = 0, rel = 0, relUnresolved = 0;
    for (const ent of result.entities) {
      const k = ent.name.trim().toLowerCase();
      // 去重：模型已回填 existingId（与已有实体为同一事物），或名称精确命中已有实体 → 跳过
      if ((ent.existingId && existingIdSet.has(ent.existingId)) || existingNameSet.has(k)) { dup++; continue; }
      existingNameSet.add(k);
      const id = `en-imp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}-${added}`;
      nameToId.set(k, id);
      idToName.set(id, ent.name);
      addProposal({
        source: 'article',
        op: {
          kind: 'addEntity',
          entity: {
            type: ent.type,
            name: ent.name,
            note: ent.note,
            fields: ent.fields?.map((f) => ({ label: f.label, value: f.value })),
            tags: ent.tags,
          },
        },
        summary: `新增${ENTITY_LABEL[ent.type]}：${ent.name}`,
      });
      added++;
    }
    for (const r of result.relations) {
      const sId = nameToId.get(r.source.trim().toLowerCase());
      const tId = nameToId.get(r.target.trim().toLowerCase());
      if (!sId || !tId || sId === tId) { relUnresolved++; continue; }
      addProposal({
        source: 'article',
        op: { kind: 'addRelation', source: sId, target: tId, type: r.type, label: r.label },
        summary: `新增关系：${idToName.get(sId) ?? r.source} → ${idToName.get(tId) ?? r.target}（${RELATION_LABEL[r.type]}）`,
      });
      rel++;
    }
    setSent({ added, dup, rel, relUnresolved });
    // 打开提案中心让用户逐条确认
    useUIStore.getState().setProposals(true);
    onClose();
  }, [result, onClose]);

  const resultList = useMemo(() => {
    if (!result) return null;
    return (
      <div className="art-result">
        <div className="art-result-head">
          识别到 {result.entities.length} 个实体 · {result.relations.length} 条关系
          <button className="mode-btn active art-send" onClick={addToQueue}>加入提案队列</button>
        </div>
        <div className="art-result-list">
          {result.entities.map((e, i) => (
            <div className="art-row" key={'e' + i}>
              <span className="art-name">{e.name}</span>
              <span className="art-type">{ENTITY_LABEL[e.type]}</span>
              {e.note && <span className="art-note">{e.note}</span>}
            </div>
          ))}
          {result.relations.map((r, i) => (
            <div className="art-row rel" key={'r' + i}>
              <span className="art-rel-text">{r.source} → {r.target}</span>
              <span className="art-type">{RELATION_LABEL[r.type]}</span>
              {r.label && <span className="art-note">{r.label}</span>}
            </div>
          ))}
        </div>
      </div>
    );
  }, [result, addToQueue]);

  return (
    <div className="modal-mask" onMouseDown={onClose}>
      <div className="modal art-import-modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>导入文章并抽取实体</h3>
        <div className="art-file-row">
          <button className="mode-btn" onClick={() => fileRef.current?.click()}>选择文件（.txt / .md）</button>
          <span className="art-file-name">{fileName || '未选择文件'}</span>
          <input ref={fileRef} type="file" accept=".txt,.md,.markdown" style={{ display: 'none' }} onChange={handleFile} />
        </div>
        <textarea
          className="art-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="粘贴文章正文，或上传文件…（模型将识别其中的实体与关系，转为提案）"
          disabled={busy}
        />
        <div className="art-actions">
          {!busy ? (
            <button className="mode-btn active" onClick={run} disabled={!text.trim()}>开始识别</button>
          ) : (
            <button className="mode-btn" onClick={stop}>停止</button>
          )}
          <span className="tip">支持 .txt / .md；结果会先进入「提案中心」由你确认后再写入。</span>
        </div>

        {error && <div className="art-error">{error}</div>}

        {resultList}

        <div className="modal-actions">
          <button className="mode-btn" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}
