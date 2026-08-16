// ============================================================
// 执行轨迹面板 TracePanel（Phase 1.5）
// ------------------------------------------------------------
// 语义层执行轨迹视图：run 列表 → 时间线步骤卡片（按来源着色，
// 对齐 Harness 视觉：tool_call=橙 / context_inject=绿 / reasoning=紫 /
// assistant=蓝 / user=灰），支持 kind 筛选、展开 detail、回放播放、
// 分叉（fork）与 AI 传输日志联动。
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { useUIStore } from '../../store/uiStore';
import { trace, isForkableStep } from './trace';
import type { TraceRun, TraceStepKind } from './trace';
import { useWorldStore } from '../../store/worldStore';

const KIND_FILTERS: { kind: TraceStepKind; label: string; color: string }[] = [
  { kind: 'user', label: '用户', color: 'gray' },
  { kind: 'assistant', label: '回复', color: 'blue' },
  { kind: 'reasoning', label: '思考', color: 'purple' },
  { kind: 'tool_call', label: '工具调用', color: 'orange' },
  { kind: 'tool_result', label: '工具结果', color: 'teal' },
  { kind: 'context_inject', label: '上下文注入', color: 'green' },
  { kind: 'system', label: '系统', color: 'gray' },
  { kind: 'subagent', label: '子代理', color: 'purple' },
  { kind: 'narrate', label: '叙事', color: 'blue' },
];

const STEP_LABEL: Record<TraceStepKind, string> = {
  user: '用户',
  assistant: 'AI 回复',
  reasoning: '推理',
  tool_call: '工具调用',
  tool_result: '工具结果',
  context_inject: '上下文注入',
  subagent: '子代理调度',
  narrate: '叙事',
  system: '系统',
};

const SOURCE_LABEL: Record<string, string> = {
  chat: '对话', extract: '文章抽取', linker: '实体关联', scene: '多模态设卡',
  template: '模板生成', subagent: '子代理', propose: '主动提议', material: '物料',
};

export function TracePanel({ docked = false }: { docked?: boolean }) {
  const show = useUIStore((s) => s.showTrace);
  const close = () => useUIStore.getState().setTrace(false);
  const worldKey = useWorldStore((s) => s.current);
  const [runs, setRuns] = useState<TraceRun[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [kinds, setKinds] = useState<Set<TraceStepKind>>(new Set(KIND_FILTERS.map((k) => k.kind)));
  const [playSeq, setPlaySeq] = useState<number | null>(null);
  const playTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // 订阅 trace 变化（run 列表刷新）
  useEffect(() => {
    const refresh = () => {
      setRuns(trace.list(worldKey));
      setSelectedId((cur) => cur && trace.getRun(cur) ? cur : null);
    };
    trace.init().then(refresh);
    const unsub = trace.subscribe(refresh);
    return () => {
      unsub();
      if (playTimer.current) clearInterval(playTimer.current);
    };
  }, [worldKey]);

  const selected = runs.find((r) => r.id === selectedId) ?? null;
  const steps = useMemo(() => (selected ? selected.steps.filter((s) => kinds.has(s.kind)) : []), [selected, kinds]);

  const toggleKind = (k: TraceStepKind) => {
    setKinds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  // 回放：从 0 步逐步高亮
  const play = () => {
    if (!steps.length) return;
    setPlaySeq(0);
    if (playTimer.current) clearInterval(playTimer.current);
    playTimer.current = setInterval(() => {
      setPlaySeq((cur) => {
        const next = (cur ?? -1) + 1;
        if (next >= steps.length) {
          if (playTimer.current) clearInterval(playTimer.current);
          return null;
        }
        return next;
      });
    }, 450);
  };
  const stopPlay = () => {
    if (playTimer.current) clearInterval(playTimer.current);
    setPlaySeq(null);
  };

  const onFork = (seq: number) => {
    if (!selected) return;
    const childId = trace.fork(selected.id, seq, { worldKey, source: 'chat' });
    if (childId) {
      setSelectedId(childId);
      const ctx = buildForkCtx(selected, seq);
      alert(`已从步骤 ${seq} 分叉出新轨迹。分叉上下文已复制到剪贴板（可粘贴给 AI 继续）：\n\n${ctx.slice(0, 300)}…`);
      try { navigator.clipboard?.writeText(ctx); } catch { /* ignore */ }
    } else {
      alert('该步骤不是合法的分叉边界（需在用户/回复/工具结果之后）。');
    }
  };

  if (!show && !docked) return null;

  return (
    <div className={docked ? 'trace-docked' : 'modal-mask'} onMouseDown={docked ? undefined : close}>
      <div className={'modal trace-modal' + (docked ? ' trace-modal-docked' : '')} onMouseDown={(e) => e.stopPropagation()}>
        <div className="trace-head">
          <h3>执行轨迹</h3>
          <span className="tip">对话与工具调用记录（语义层）；「AI 日志」是传输层（HTTP）</span>
          <label className="trace-toggle">
            <input
              type="checkbox"
              checked={trace.isEnabled()}
              onChange={(e) => trace.setEnabled(e.target.checked)}
            />
            记录
          </label>
          <button className="mode-btn" onClick={() => { if (confirm('清空当前世界全部轨迹？')) trace.clearAll(worldKey); }}>清空</button>
          <button className="mode-btn" onClick={close}>关闭</button>
        </div>

        <div className="trace-body">
          {/* run 列表 */}
          <div className="trace-runs">
            <div className="trace-runs-title">执行记录（{runs.length}）</div>
            {runs.length === 0 ? (
              <div className="trace-empty">暂无轨迹。运行一次带工具调用的对话（AI 侧栏）后这里会记录完整执行过程。</div>
            ) : (
              runs.map((r) => (
                <div
                  key={r.id}
                  className={'trace-run' + (r.id === selectedId ? ' active' : '')}
                  onClick={() => { setSelectedId(r.id); stopPlay(); }}
                >
                  <div className="trace-run-title">{r.title || '（无标题）'}{r.parentRunId && <span className="trace-fork-tag">分叉</span>}</div>
                  <div className="trace-run-meta">
                    {SOURCE_LABEL[r.source] ?? r.source} · {r.steps.length} 步 ·{' '}
                    {new Date(r.createdAt).toLocaleTimeString()}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* 时间线 */}
          <div className="trace-detail">
            {!selected ? (
              <div className="trace-empty">选择左侧一条执行记录查看轨迹时间线。</div>
            ) : (
              <>
                <div className="trace-detail-head">
                  <span className="tip">「{selected.title}」— {selected.steps.length} 步</span>
                  {selected.parentRunId && <span className="trace-fork-tag">源自 {selected.forkFromStep ?? 0} 步分叉</span>}
                  <button className="mode-btn" onClick={play} disabled={steps.length === 0}>回放</button>
                  <button className="mode-btn" onClick={stopPlay} disabled={playSeq === null}>停止</button>
                </div>
                <div className="trace-filters">
                  {KIND_FILTERS.map((f) => (
                    <label key={f.kind} className={'trace-kind t-' + f.color + (kinds.has(f.kind) ? ' on' : '')}>
                      <input type="checkbox" checked={kinds.has(f.kind)} onChange={() => toggleKind(f.kind)} />
                      {f.label}
                    </label>
                  ))}
                </div>
                <div className="trace-steps">
                  {steps.map((s) => (
                    <TraceStepItem
                      key={s.seq}
                      run={selected}
                      seq={s.seq}
                      playing={playSeq !== null && s.seq === steps[Math.min(playSeq, steps.length - 1)]?.seq}
                      onFork={onFork}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TraceStepItem({ run, seq, playing, onFork }: {
  run: TraceRun; seq: number; playing: boolean; onFork: (seq: number) => void;
}) {
  const step = run.steps.find((s) => s.seq === seq)!;
  const [open, setOpen] = useState(false);
  const setAILog = useUIStore((s) => s.setAILog);
  return (
    <div className={'trace-step st-' + step.kind + (playing ? ' playing' : '')}>
      <div className="trace-step-main" onClick={() => setOpen((v) => !v)}>
        <span className="trace-step-kind">{STEP_LABEL[step.kind]}</span>
        <span className="trace-step-summary">{step.summary}</span>
        <span className="trace-step-ts">{new Date(step.ts).toLocaleTimeString()}</span>
      </div>
      {open && step.detail && <pre className="trace-step-detail">{step.detail}</pre>}
      <div className="trace-step-ops">
        {isForkableStep(step.kind) && (
          <button className="ol-btn" title="从此步分叉出新轨迹" onClick={() => onFork(seq)}>分叉</button>
        )}
        <button className="ol-btn" title="查看该次任务的传输日志（HTTP）" onClick={() => setAILog(true)}>日志</button>
      </div>
    </div>
  );
}

function buildForkCtx(run: TraceRun, stepSeq: number): string {
  const prefix = run.steps.filter((s) => s.seq <= stepSeq);
  return prefix.map((s) => `[${s.kind}] ${s.summary}`).join('\n');
}
