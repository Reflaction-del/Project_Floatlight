// ============================================================
// 提案中心（Phase 0）
// ------------------------------------------------------------
// 展示当前世界 AI 提案队列中的所有提案，按来源分组；用户可逐条
// 采纳 / 拒绝，或一键采纳全部待处理项。所有改动在采纳时才落地。
// ============================================================

import { useMemo } from 'react';
import { useWorldStore } from '../store/worldStore';
import { useUIStore } from '../store/uiStore';
import { IconProposals } from './icons';
import { PROPOSAL_SOURCE_LABEL, type Proposal, type ProposalSource } from '../store/proposalTypes';

const SOURCE_ORDER: ProposalSource[] = ['article', 'material', 'linker', 'template-gen', 'chat', 'manual'];

function opDetail(p: Proposal): string {
  switch (p.op.kind) {
    case 'addEntity':
      return `新增${p.op.entity.type}实体：${p.op.entity.name}`;
    case 'addRelation':
      return `新增关系：${p.op.source} → ${p.op.target}（${p.op.type}）`;
    case 'updateEntity':
      return `修改实体 ${p.op.entityId} 字段`;
    case 'addTemplate':
      return `新增模板：${p.op.template.name}`;
  }
}

export function ProposalCenter() {
  const show = useUIStore((s) => s.showProposals);
  const close = () => useUIStore.getState().setProposals(false);
  const proposals = useWorldStore((s) => s.worldsData[s.current]?.proposals ?? []);
  const acceptProposal = useWorldStore((s) => s.acceptProposal);
  const rejectProposal = useWorldStore((s) => s.rejectProposal);
  const acceptAll = useWorldStore((s) => s.acceptAllProposals);
  const clearResolved = useWorldStore((s) => s.clearResolvedProposals);

  const grouped = useMemo(() => {
    const map = new Map<ProposalSource, Proposal[]>();
    for (const p of proposals) {
      const arr = map.get(p.source) ?? [];
      arr.push(p);
      map.set(p.source, arr);
    }
    const ordered = SOURCE_ORDER.filter((k) => map.has(k)).map((k) => [k, map.get(k)!] as const);
    return ordered;
  }, [proposals]);

  const pending = proposals.filter((p) => p.status === 'pending').length;
  const resolved = proposals.length - pending;

  if (!show) return null;

  return (
    <div className="modal-mask" onMouseDown={close}>
      <div className="modal prop-modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>
          <IconProposals style={{ marginRight: 8, verticalAlign: '-3px' }} />
          提案中心
          {pending > 0 && <span className="prop-count">待处理 {pending}</span>}
          {resolved > 0 && <span className="prop-count resolved">已处理 {resolved}</span>}
        </h3>

        {proposals.length === 0 ? (
          <div className="prop-empty">
            <div>暂无提案。</div>
            <div className="tip">AI 生成的实体、关系、字段或模板会先进入这里，由你逐条确认后再写入世界观。</div>
          </div>
        ) : (
          <div className="prop-list">
            {grouped.map(([source, items]) => (
              <div className="prop-group" key={source}>
                <div className="prop-group-title">
                  {items[0].sourceLabel ?? PROPOSAL_SOURCE_LABEL[source]}
                  <span className="prop-group-count">{items.length}</span>
                </div>
                {items.map((p) => (
                  <div className={'prop-item ' + p.status} key={p.id}>
                    <div className="prop-item-main">
                      <div className="prop-item-summary">{p.summary}</div>
                      <div className="prop-item-detail">{opDetail(p)}</div>
                    </div>
                    <div className="prop-item-ops">
                      {p.status === 'pending' && (
                        <>
                          <button className="mode-btn active prop-accept" onClick={() => acceptProposal(p.id)}>采纳</button>
                          <button className="mode-btn prop-reject" onClick={() => rejectProposal(p.id)}>拒绝</button>
                        </>
                      )}
                      {p.status === 'accepted' && <span className="prop-status accepted">✓ 已采纳</span>}
                      {p.status === 'rejected' && <span className="prop-status rejected">✕ 已拒绝</span>}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        <div className="modal-actions">
          {pending > 0 && (
            <button className="mode-btn active" onClick={acceptAll}>全部采纳（{pending}）</button>
          )}
          {resolved > 0 && (
            <button className="mode-btn" onClick={clearResolved}>清空已处理</button>
          )}
          <button className="mode-btn" onClick={close}>关闭</button>
        </div>
      </div>
    </div>
  );
}
