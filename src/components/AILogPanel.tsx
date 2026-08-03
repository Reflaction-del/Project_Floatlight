// ============================================================
// AI 调用进度 / 回复日志窗口
// ------------------------------------------------------------
// 全局弹窗：实时展示大模型调用的请求阶段、HTTP 状态、收到的
// 内容量与原始回复摘要。任何 AI 功能出错（如「模型返回为空」）
// 时，用户可直接看到端点到底回了什么，便于自查配置。
// 由 uiStore.showAILog 控制（App.tsx 全局挂载，同 ProposalCenter）。
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { useUIStore } from '../store/uiStore';
import {
  subscribeAI, clearAILogs, getAILogs, fmtLogTime, truncate,
  type AILogEntry,
} from '../utils/aiLog';

const LEVEL_CLASS: Record<AILogEntry['level'], string> = {
  info: 'ai-log-info',
  ok: 'ai-log-ok',
  warn: 'ai-log-warn',
  error: 'ai-log-error',
};
const LEVEL_TEXT: Record<AILogEntry['level'], string> = {
  info: 'INFO', ok: 'OK', warn: 'WARN', error: 'ERROR',
};

export function AILogPanel() {
  const show = useUIStore((s) => s.showAILog);
  const [logs, setLogs] = useState<AILogEntry[]>(() => getAILogs());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    if (!show) return;
    const unsub = subscribeAI((next) => setLogs(next));
    return unsub;
  }, [show]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [logs]);

  if (!show) return null;

  const toggleEntry = (i: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };

  const copyAll = async () => {
    const text = logs
      .map((l) => `[${fmtLogTime(l.time)}] [${LEVEL_TEXT[l.level]}] [${l.phase}] ${l.message}${l.detail ? '\n  ' + l.detail : ''}${l.raw ? '\n  raw: ' + l.raw : ''}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  return (
    <div className="modal-mask" onMouseDown={() => useUIStore.getState().setAILog(false)}>
      <div className="modal ai-log-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ai-log-head">
          <h3>AI 调用日志</h3>
          <span className="tip">实时展示大模型请求阶段与原始回复，便于排查「模型返回为空」等问题</span>
          <div className="ai-log-tools">
            <button className="mode-btn" onClick={() => setExpanded(new Set(logs.map((_, i) => i)))}>全部展开</button>
            <button className="mode-btn" onClick={() => setExpanded(new Set())}>收起</button>
            <button className="mode-btn" onClick={copyAll}>{copied ? '✓ 已复制' : '复制日志'}</button>
            <button className="mode-btn" onClick={clearAILogs}>清空</button>
            <button className="mode-btn" onClick={() => useUIStore.getState().setAILog(false)}>关闭</button>
          </div>
        </div>
        <div
          className="ai-log-body"
          ref={scrollRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
          }}
        >
          {logs.length === 0 && <div className="placeholder-view" style={{ minHeight: 120 }}><div>暂无日志</div><div>执行一次 AI 操作（对话 / 文章抽取 / 实体关联等）后，这里会显示请求明细</div></div>}
          {logs.map((l, i) => (
            <div key={i} className={'ai-log-entry ' + LEVEL_CLASS[l.level]}>
              <div className="ai-log-entry-head" onClick={() => toggleEntry(i)}>
                <span className="ai-log-time">{fmtLogTime(l.time)}</span>
                <span className="ai-log-level">{LEVEL_TEXT[l.level]}</span>
                <span className="ai-log-phase">{l.phase}</span>
                <span className="ai-log-msg">{l.message}</span>
                <span className="ai-log-toggle">{expanded.has(i) ? '▾' : '▸'}</span>
              </div>
              {(expanded.has(i) || l.level === 'error') && (l.detail || l.raw) && (
                <div className="ai-log-entry-detail">
                  {l.detail && <pre className="ai-log-detail">{l.detail}</pre>}
                  {l.raw && <pre className="ai-log-raw">{truncate(l.raw, 1200)}</pre>}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
