import { useState, useMemo } from 'react';
import { useAIUsageStore, AI_USAGE_FEATURE_LABELS, type PeriodMode, periodRange } from '../../store/aiUsageStore';
import { useAIStore } from '../../store/aiStore';
import { storage } from '../../storage';

type TabKey = 'overview' | 'model' | 'feature' | 'detail' | 'export';

function fmtNum(n: number) {
  return n.toLocaleString('zh-CN');
}

function fmtCost(n: number) {
  return n <= 0 ? '—' : `¥${n.toFixed(4)}`;
}

export function AIUsagePanel() {
  const [tab, setTab] = useState<TabKey>('overview');
  const [period, setPeriod] = useState<PeriodMode>('today');
  const records = useAIUsageStore((s) => s.records);
  const activeAlert = useAIUsageStore((s) => s.alert);
  const dismissAlert = useAIUsageStore((s) => s.dismissAlert);
  const clear = useAIUsageStore((s) => s.clear);
  const models = useAIStore((s) => s.models);

  const stats = useMemo(() => useAIUsageStore.getState().getStats(period), [records, period]);
  const byModel = useMemo(() => useAIUsageStore.getState().getByModel(period), [records, period]);
  const byFeature = useMemo(() => useAIUsageStore.getState().getByFeature(period), [records, period]);

  const filteredRecords = useMemo(() => {
    if (period === 'all') return [...records].reverse();
    const range = periodRange(period);
    if (!range) return [...records].reverse();
    return [...records].filter((r) => r.timestamp >= range.start && r.timestamp <= range.end).reverse();
  }, [records, period]);

  const exportCSV = () => {
    const csv = useAIUsageStore.getState().exportCSV();
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AI用量_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const periodLabel = period === 'today' ? '今日' : period === 'month' ? '本月' : '全部';

  return (
    <div className="ai-usage-panel">
      {activeAlert && (
        <div className="ai-usage-alert">
          <span>{activeAlert.message}</span>
          <button className="mode-btn" onClick={dismissAlert}>知道了</button>
        </div>
      )}

      <div className="ai-usage-toolbar">
        <div className="ai-usage-periods">
          {(['today', 'month', 'all'] as PeriodMode[]).map((p) => (
            <button key={p} className={'mode-btn' + (period === p ? ' active' : '')} onClick={() => setPeriod(p)}>
              {p === 'today' ? '今日' : p === 'month' ? '本月' : '全部'}
            </button>
          ))}
        </div>
        <div className="ai-usage-tabs">
          {[
            { key: 'overview', label: '概览' },
            { key: 'model', label: '按模型' },
            { key: 'feature', label: '按功能' },
            { key: 'detail', label: '明细' },
            { key: 'export', label: '导出' },
          ].map((t) => (
            <button key={t.key} className={'mode-btn' + (tab === t.key ? ' active' : '')} onClick={() => setTab(t.key as TabKey)}>{t.label}</button>
          ))}
        </div>
      </div>

      {tab === 'overview' && (
        <>
          <div className="ai-usage-cards">
            <div className="ai-usage-card"><div className="ai-usage-card-num">{fmtNum(stats.requests)}</div><div className="ai-usage-card-cap">{periodLabel}请求数</div></div>
            <div className="ai-usage-card"><div className="ai-usage-card-num">{fmtNum(stats.inputTokens)}</div><div className="ai-usage-card-cap">{periodLabel}输入 Tokens</div></div>
            <div className="ai-usage-card"><div className="ai-usage-card-num">{fmtNum(stats.outputTokens)}</div><div className="ai-usage-card-cap">{periodLabel}输出 Tokens</div></div>
            <div className="ai-usage-card"><div className="ai-usage-card-num">{fmtCost(stats.cost)}</div><div className="ai-usage-card-cap">{periodLabel}估算费用</div></div>
          </div>
          <div className="ai-usage-budgets">
            <h4>模型预算上限</h4>
            {models.length === 0 && <div className="tip">尚未配置模型。</div>}
            {models.map((m) => {
              if (!m.requiresMetering || (!m.budgetLimit && !m.tokenBudget)) return null;
              const range = periodRange(period);
              const modelRecords = records.filter((r) => r.modelId === m.id && (!range || (r.timestamp >= range.start && r.timestamp <= range.end)));
              const spentCost = modelRecords.reduce((s, r) => s + r.cost, 0);
              const spentTokens = modelRecords.reduce((s, r) => s + r.inputTokens + r.outputTokens, 0);
              return (
                <div key={m.id} className="ai-usage-budget-row">
                  <div className="ai-usage-budget-name">{m.label || m.model}</div>
                  {!!m.budgetLimit && (
                    <div className="ai-usage-budget-bar">
                      <div className="ai-usage-budget-track"><div className="ai-usage-budget-fill" style={{ width: `${Math.min(100, (spentCost / m.budgetLimit) * 100)}%`, background: spentCost >= m.budgetLimit ? 'var(--danger)' : 'var(--accent)' }} /></div>
                      <span className="ai-usage-budget-text">费用 {fmtCost(spentCost)} / ¥{m.budgetLimit.toFixed(2)}</span>
                    </div>
                  )}
                  {!!m.tokenBudget && (
                    <div className="ai-usage-budget-bar">
                      <div className="ai-usage-budget-track"><div className="ai-usage-budget-fill" style={{ width: `${Math.min(100, (spentTokens / m.tokenBudget) * 100)}%`, background: spentTokens >= m.tokenBudget ? 'var(--danger)' : 'var(--accent)' }} /></div>
                      <span className="ai-usage-budget-text">Tokens {fmtNum(spentTokens)} / {fmtNum(m.tokenBudget)}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {tab === 'model' && (
        <table className="ai-usage-table">
          <thead><tr><th>模型</th><th>请求数</th><th>输入 Tokens</th><th>输出 Tokens</th><th>估算费用</th></tr></thead>
          <tbody>
            {Object.entries(byModel).sort((a, b) => b[1].cost - a[1].cost).map(([name, s]) => (
              <tr key={name}><td>{name}</td><td>{fmtNum(s.requests)}</td><td>{fmtNum(s.inputTokens)}</td><td>{fmtNum(s.outputTokens)}</td><td>{fmtCost(s.cost)}</td></tr>
            ))}
            {Object.keys(byModel).length === 0 && <tr><td colSpan={5} className="tip">暂无记录</td></tr>}
          </tbody>
        </table>
      )}

      {tab === 'feature' && (
        <table className="ai-usage-table">
          <thead><tr><th>功能</th><th>请求数</th><th>输入 Tokens</th><th>输出 Tokens</th><th>估算费用</th></tr></thead>
          <tbody>
            {Object.entries(byFeature).sort((a, b) => b[1].cost - a[1].cost).map(([name, s]) => (
              <tr key={name}><td>{AI_USAGE_FEATURE_LABELS[name as keyof typeof AI_USAGE_FEATURE_LABELS] || name}</td><td>{fmtNum(s.requests)}</td><td>{fmtNum(s.inputTokens)}</td><td>{fmtNum(s.outputTokens)}</td><td>{fmtCost(s.cost)}</td></tr>
            ))}
            {Object.keys(byFeature).length === 0 && <tr><td colSpan={5} className="tip">暂无记录</td></tr>}
          </tbody>
        </table>
      )}

      {tab === 'detail' && (
        <>
          <div className="ai-usage-table-wrap">
            <table className="ai-usage-table">
              <thead><tr><th>时间</th><th>模型</th><th>功能</th><th>输入</th><th>输出</th><th>费用</th></tr></thead>
              <tbody>
                {filteredRecords.map((r) => (
                  <tr key={r.id}><td>{new Date(r.timestamp).toLocaleString('zh-CN')}</td><td>{r.modelLabel}</td><td>{AI_USAGE_FEATURE_LABELS[r.feature]}</td><td>{fmtNum(r.inputTokens)}</td><td>{fmtNum(r.outputTokens)}</td><td>{fmtCost(r.cost)}</td></tr>
                ))}
                {filteredRecords.length === 0 && <tr><td colSpan={6} className="tip">暂无记录</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="ai-usage-actions">
            <button className="mode-btn danger" onClick={() => { if (window.confirm('确定清空全部用量记录？此操作不可恢复。')) clear(); }}>清空记录</button>
          </div>
        </>
      )}

      {tab === 'export' && (
        <div className="ai-usage-export">
          <p className="tip">导出包含所有历史记录的 CSV（UTF-8 编码，带 BOM，Excel 可直接打开）。</p>
          <div className="ai-usage-actions">
            <button className="mode-btn active" onClick={exportCSV}>导出 CSV</button>
            <button className="mode-btn" onClick={() => {
              const csv = useAIUsageStore.getState().exportCSV();
              navigator.clipboard.writeText(csv).then(() => alert('已复制 CSV 到剪贴板'));
            }}>复制 CSV</button>
          </div>
        </div>
      )}
    </div>
  );
}
