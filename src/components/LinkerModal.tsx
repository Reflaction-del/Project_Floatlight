// ============================================================
// 实体关联工具（Phase 1b · 功能3）
// ------------------------------------------------------------
// 粘贴文本，选择 精确 / 模糊 / 大模型 三种匹配模式，
// 将文中出现的实体名称与实体库关联，结果进入统一提案队列。
// ============================================================

import { useState, useRef } from 'react';
import { useWorldStore } from '../store/worldStore';
import { useUIStore } from '../store/uiStore';
import { linkEntities, type LinkMode, type LinkCandidate } from '../features/ai/entityLinker';
import { ENTITY_LABEL } from '../types';

const MODES: { key: LinkMode; label: string; hint: string }[] = [
  { key: 'exact', label: '精确匹配', hint: '名称完全一致才关联' },
  { key: 'fuzzy', label: '模糊匹配', hint: '编辑距离≤2 / 包含关系视作同一实体' },
  { key: 'llm', label: '大模型对应', hint: '由模型判断每个名称指代哪个实体' },
];

export function LinkerModal({ onClose }: { onClose: () => void }) {
  const entities = useWorldStore((s) => s.worldsData[s.current]?.entities ?? []);
  const [text, setText] = useState('');
  const [mode, setMode] = useState<LinkMode>('fuzzy');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<LinkCandidate[] | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = async () => {
    const t = text.trim();
    if (!t) { setError('请先粘贴待关联的文本或名称。'); return; }
    if (entities.length === 0) { setError('当前世界还没有实体，无法关联。请先在实体库建立实体。'); return; }
    setBusy(true);
    setError(null);
    setCandidates(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await linkEntities(t, entities, mode, ctrl.signal);
      setCandidates(res);
    } catch (err: any) {
      if (err?.name === 'AbortError' || err === '手动终止') setError('已取消关联。');
      else setError('关联失败：' + (err?.message || String(err)));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const stop = () => abortRef.current?.abort();

  const addToQueue = () => {
    if (!candidates) return;
    const ws = useWorldStore.getState();
    const addProposal = ws.addProposal;
    const existing = ws.worldsData[ws.current]?.entities ?? [];
    const byId = new Map(existing.map((e) => [e.id, e]));
    let alias = 0, news = 0;
    for (const c of candidates) {
      if (c.action === 'alias' && c.targetId) {
        const ent = byId.get(c.targetId);
        if (!ent) continue;
        const tags = Array.from(new Set([...(ent.tags ?? []), c.mention]));
        addProposal({
          source: 'linker',
          op: { kind: 'updateEntity', entityId: c.targetId, patch: { tags } },
          summary: `将「${c.mention}」作为别名关联到「${c.targetName ?? c.targetId}」`,
        });
        alias++;
      } else if (c.action === 'new' && c.newType) {
        addProposal({
          source: 'linker',
          op: { kind: 'addEntity', entity: { type: c.newType, name: c.mention } },
          summary: `新增${ENTITY_LABEL[c.newType]}：${c.mention}`,
        });
        news++;
      }
    }
    if (alias + news === 0) { setError('没有可关联的候选，请调整文本或匹配模式。'); return; }
    useUIStore.getState().setProposals(true);
    onClose();
  };

  return (
    <div className="modal-mask" onMouseDown={onClose}>
      <div className="modal art-import-modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>实体关联（名称 → 实体库）</h3>
        <div className="link-modes">
          {MODES.map((m) => (
            <button
              key={m.key}
              className={'link-mode' + (mode === m.key ? ' active' : '')}
              title={m.hint}
              onClick={() => setMode(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <textarea
          className="art-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="粘贴包含实体名称的文本（文章片段、名单、对话稿…），模型/算法会识别其中的名称并与实体库关联。"
          disabled={busy}
        />
        <div className="art-actions">
          {!busy ? (
            <button className="mode-btn active" onClick={run} disabled={!text.trim()}>开始关联</button>
          ) : (
            <button className="mode-btn" onClick={stop}>停止</button>
          )}
          <span className="tip">当前实体库 {entities.length} 个实体。结果进入「提案中心」由你确认。</span>
        </div>

        {error && <div className="art-error">{error}</div>}

        {candidates && (
          <div className="art-result">
            <div className="art-result-head">
              关联候选 {candidates.length} 条
              <button className="mode-btn active art-send" onClick={addToQueue}>加入提案队列</button>
            </div>
            <div className="art-result-list">
              {candidates.length === 0 && <div className="art-note">未找到可关联的实体名称，换个匹配模式或补充文本再试。</div>}
              {candidates.map((c, i) => (
                <div className="art-row" key={i}>
                  <span className="art-name">{c.mention}</span>
                  {c.action === 'alias' ? (
                    <>
                      <span className="art-type">别名 →</span>
                      <span className="art-name">{c.targetName}</span>
                    </>
                  ) : (
                    <>
                      <span className="art-type">新建</span>
                      <span className="art-type">{ENTITY_LABEL[c.newType ?? 'character']}</span>
                    </>
                  )}
                  {c.reason && <span className="art-note">{c.reason}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="modal-actions">
          <button className="mode-btn" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}
