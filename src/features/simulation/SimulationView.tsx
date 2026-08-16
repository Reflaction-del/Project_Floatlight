// ============================================================
// 沙盘视图 SimulationView（Phase 3 多子代理·角色模拟）
// ------------------------------------------------------------
// 观察式沙盘 / 导演式双模式：事件流（按 actor/kind 着色）、角色卡
// 面板（人格词/模型/策略/记忆槽可编辑）、控制条（推进/自动连推/
// 导演指令）、推演事件「采纳落时间线」走提案队列（simulation 来源）。
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { useWorldStore } from '../../store/worldStore';
import { useAIStore } from '../../store/aiStore';
import { useUIStore } from '../../store/uiStore';
import { trace } from '../agent/trace';
import { runSimulationStep, runSimulationSteps } from './runtime';
import {
  SIM_MODE_LABEL, SIM_PACING_LABEL, SIM_ROLE_LABEL, SIM_EVENT_LABEL,
  SIM_TIME_UNIT_LABEL, type Simulation, type SubAgent, type SimMode, type SimPacing, type SimTimeUnit,
} from './types';

/** 从实体库构造角色代理（默认人格词基于角色名） */
function makeActor(entityId: string, name: string, role: SubAgent['role'] = 'protagonist'): SubAgent {
  return {
    id: `agent-${entityId}-${Math.random().toString(36).slice(2, 6)}`,
    entityId,
    role,
    personaPrompt: `你正在扮演「${name}」。请依据你在世界观中的设定、身份与目标行动，保持人设一致。`,
    memorySlot: [],
    strategy: 'autonomous',
  };
}

export function SimulationView() {
  const simulations = useWorldStore((s) => s.worldsData[s.current]?.simulations ?? []);
  const world = useWorldStore((s) => s.worldsData[s.current]);
  const addSimulation = useWorldStore((s) => s.addSimulation);
  const updateSimulation = useWorldStore((s) => s.updateSimulation);
  const deleteSimulation = useWorldStore((s) => s.deleteSimulation);
  const updateActor = useWorldStore((s) => s.updateSimulationActor);
  const addProposal = useWorldStore((s) => s.addProposal);
  const models = useAIStore((s) => s.models);

  const [activeId, setActiveId] = useState<string | null>(null);
  const active = simulations.find((s) => s.id === activeId) ?? simulations[0] ?? null;

  // —— 创建表单 ——
  const [showCreate, setShowCreate] = useState(false);
  const [cTitle, setCTitle] = useState('未命名模拟');
  const [cScenario, setCScenario] = useState('');
  const [cMode, setCMode] = useState<SimMode>('sandbox');
  const [cPacing, setCPacing] = useState<SimPacing>('step');
  const [cAutoSteps, setCAutoSteps] = useState(5);
  const [cTimeScale, setCTimeScale] = useState<{ on: boolean; unit: SimTimeUnit; span: number }>({ on: false, unit: 'week', span: 1 });
  const [cActorIds, setCActorIds] = useState<string[]>([]);

  // —— 运行时 ——
  const [running, setRunning] = useState(false);
  const [directive, setDirective] = useState('');
  const [selectedActor, setSelectedActor] = useState<string>('');
  const abortRef = useRef<AbortController | null>(null);

  const entities = world?.entities ?? [];
  const timelines = world?.timelines ?? [];
  const characterOptions = useMemo(() => entities.filter((e) => e.type === 'character' || e.type === 'faction'), [entities]);

  // 创建后自动选中
  useEffect(() => {
    if (activeId && !simulations.find((s) => s.id === activeId)) setActiveId(null);
  }, [simulations, activeId]);

  const doCreate = () => {
    const actors = cActorIds
      .map((id) => {
        const e = entities.find((x) => x.id === id);
        return e ? makeActor(e.id, e.name) : null;
      })
      .filter((x): x is SubAgent => !!x);
    if (actors.length === 0) { alert('请至少选择一个角色'); return; }
    const id = addSimulation({
      mode: cMode,
      title: cTitle || '未命名模拟',
      scenario: cScenario || '（未填写初始场景）',
      actors,
      pacing: cPacing,
      autoSteps: cAutoSteps,
      timeScale: cTimeScale.on ? { unit: cTimeScale.unit, span: cTimeScale.span } : undefined,
    });
    setActiveId(id);
    setShowCreate(false);
    setCActorIds([]);
    setCScenario('');
  };

  const stepOnce = async (actorId?: string, directiveText?: string) => {
    if (!active || !world || running) return;
    setRunning(true);
    abortRef.current = new AbortController();
    // 模拟专属轨迹 run
    const runId = trace.isEnabled()
      ? trace.startRun({ worldKey: useWorldStore.getState().current, source: 'subagent', title: `模拟：${active.title}` })
      : '';
    try {
      const result = await runSimulationStep(
        { world, sim: active, actorId, userDirective: directiveText, signal: abortRef.current.signal, traceRunId: runId },
        {},
      );
      if (result.sim !== active) updateSimulation(active.id, result.sim);
      if (result.error && !result.event) alert(result.error);
    } finally {
      setRunning(false);
      abortRef.current = null;
      if (runId) trace.finishRun(runId);
    }
  };

  const runAuto = async () => {
    if (!active || !world || running) return;
    setRunning(true);
    abortRef.current = new AbortController();
    const runId = trace.isEnabled()
      ? trace.startRun({ worldKey: useWorldStore.getState().current, source: 'subagent', title: `模拟自动推演：${active.title}` })
      : '';
    try {
      const result = await runSimulationSteps(
        { world, sim: active, steps: active.autoSteps, signal: abortRef.current.signal, traceRunId: runId },
        {},
        (r) => {
          if (r.sim !== active) updateSimulation(active.id, r.sim); // 逐步落盘
        },
      );
      if (result.sim !== active) updateSimulation(active.id, result.sim);
    } finally {
      setRunning(false);
      abortRef.current = null;
      if (runId) trace.finishRun(runId);
    }
  };

  const stopRun = () => { abortRef.current?.abort(); setRunning(false); };

  /** 事件 → 时间线提案（走提案队列，用户确认后落库） */
  const adoptToTimeline = (content: string) => {
    const tl = timelines[0];
    if (!tl) { alert('当前世界还没有时间线，请先创建一条。'); return; }
    addProposal({
      source: 'simulation',
      summary: `将推演事件采纳到时间线「${tl.name}」`,
      op: {
        kind: 'addTimelineEvent',
        timelineId: tl.id,
        event: { label: content.slice(0, 60), year: 0, note: content.slice(0, 200), impact: 30 },
      },
    });
    useUIStore.getState().setProposals(true); // 打开提案中心让用户确认
  };

  return (
    <div className="sim-view">
      <div className="sim-head">
        <h3>角色模拟</h3>
        <span className="tip">观察式沙盘：角色自主推进｜导演式：你指定角色与指令</span>
        <button className="mode-btn active" onClick={() => setShowCreate((v) => !v)}>{showCreate ? '收起' : '+ 新建模拟'}</button>
      </div>

      {showCreate && (
        <div className="sim-create">
          <div className="sim-form-row">
            <label>标题 <input value={cTitle} onChange={(e) => setCTitle(e.target.value)} /></label>
            <label>模式
              <select value={cMode} onChange={(e) => setCMode(e.target.value as SimMode)}>
                <option value="sandbox">观察式沙盘</option>
                <option value="directed">导演式</option>
              </select>
            </label>
            <label>节奏
              <select value={cPacing} onChange={(e) => setCPacing(e.target.value as SimPacing)}>
                <option value="step">每步确认</option>
                <option value="auto">自动连推</option>
              </select>
            </label>
            {cPacing === 'auto' && (
              <label>连推步数 <input type="number" min={1} max={20} value={cAutoSteps} onChange={(e) => setCAutoSteps(Number(e.target.value) || 5)} style={{ width: 60 }} /></label>
            )}
            <label className="sim-timescale">
              <input type="checkbox" checked={cTimeScale.on} onChange={(e) => setCTimeScale((v) => ({ ...v, on: e.target.checked }))} /> 时间尺度推演
              {cTimeScale.on && (
                <span>
                  <input type="number" min={1} max={999} value={cTimeScale.span} onChange={(e) => setCTimeScale((v) => ({ ...v, span: Number(e.target.value) || 1 }))} style={{ width: 56 }} />
                  <select value={cTimeScale.unit} onChange={(e) => setCTimeScale((v) => ({ ...v, unit: e.target.value as SimTimeUnit }))}>
                    {Object.entries(SIM_TIME_UNIT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </span>
              )}
            </label>
          </div>
          <div className="sim-form-row">
            <label className="sim-scenario">初始场景
              <textarea rows={2} value={cScenario} onChange={(e) => setCScenario(e.target.value)} placeholder="例如：雨夜的城门口，林夜与苏泠对峙。" />
            </label>
          </div>
          <div className="sim-actor-pick">
            <span className="tip">选择角色（实体库中的角色/势力）：</span>
            <div className="sim-chips">
              {characterOptions.map((e) => (
                <button
                  key={e.id}
                  className={'sim-chip' + (cActorIds.includes(e.id) ? ' on' : '')}
                  onClick={() => setCActorIds((prev) => prev.includes(e.id) ? prev.filter((x) => x !== e.id) : [...prev, e.id])}
                >
                  {e.name}
                </button>
              ))}
              {characterOptions.length === 0 && <span className="tip">实体库还没有角色/势力，先到「实体库」创建。</span>}
            </div>
          </div>
          <button className="mode-btn active" onClick={doCreate} disabled={cActorIds.length === 0}>创建模拟</button>
        </div>
      )}

      {simulations.length === 0 && !showCreate ? (
        <div className="sim-empty">
          <p>还没有模拟会话。点击「新建模拟」选择角色，让 AI 基于世界观与角色卡自主推进故事。</p>
          <div className="tip">每个角色可单独配置模型与人格提示词；推演过程记录在「执行轨迹」中，事件可采纳到时间线（走提案）。</div>
        </div>
      ) : (
        <div className="sim-body">
          {/* 模拟列表 */}
          <div className="sim-list">
            {simulations.map((s) => (
              <div key={s.id} className={'sim-item' + (active?.id === s.id ? ' active' : '')} onClick={() => setActiveId(s.id)}>
                <div className="sim-item-title">{s.title}</div>
                <div className="sim-item-meta">
                  {SIM_MODE_LABEL[s.mode]} · {s.actors.length} 角色 · {s.events.length} 步
                  {s.status === 'ended' && <span className="sim-ended">已结束</span>}
                </div>
              </div>
            ))}
            {active && (
              <button className="ol-btn danger" style={{ marginTop: 8 }} onClick={() => { if (confirm(`删除模拟「${active.title}」？`)) deleteSimulation(active.id); }}>删除当前</button>
            )}
          </div>

          {!active ? null : (
            <div className="sim-main">
              {/* 控制条 */}
              <div className="sim-controls">
                <span className="sim-mode-tag">{SIM_MODE_LABEL[active.mode]}</span>
                {active.mode === 'directed' ? (
                  <>
                    <select value={selectedActor} onChange={(e) => setSelectedActor(e.target.value)}>
                      <option value="">选择角色…</option>
                      {active.actors.map((a) => <option key={a.id} value={a.id}>{a.entityId}</option>)}
                    </select>
                    <input
                      className="sim-directive"
                      value={directive}
                      onChange={(e) => setDirective(e.target.value)}
                      placeholder="导演指令：让角色做什么/说什么…"
                      onKeyDown={(e) => { if (e.key === 'Enter' && !running) { stepOnce(selectedActor || undefined, directive); setDirective(''); } }}
                    />
                  </>
                ) : (
                  <span className="tip">观察式沙盘：自主角色按序行动</span>
                )}
                {active.pacing === 'auto' && (
                  <button className="mode-btn" onClick={runAuto} disabled={running || active.status === 'ended'}>{running ? '推演中…' : `自动推 ${active.autoSteps} 步`}</button>
                )}
                <button
                  className="mode-btn active"
                  onClick={() => active.mode === 'directed' ? stepOnce(selectedActor || undefined, directive || undefined) : stepOnce()}
                  disabled={running || active.status === 'ended'}
                >
                  {active.mode === 'directed' ? '推进所选角色' : '推进一步'}
                </button>
                {running && <button className="co-stop-btn" onClick={stopRun}>停止</button>}
              </div>

              {/* 事件流 */}
              <div className="sim-events">
                {active.events.length === 0 ? (
                  <div className="sim-empty">还没有事件。点「推进」开始；事件会自动写入各角色的经历记忆。</div>
                ) : (
                  active.events.map((ev) => {
                    const actor = active.actors.find((a) => a.id === ev.actor);
                    const name = ev.actor === 'narrator' ? '叙事者' : actor?.entityId ?? ev.actor;
                    return (
                      <div key={ev.id} className={'sim-event se-' + ev.kind}>
                        <div className="sim-event-head">
                          <span className="sim-event-step">#{ev.step}</span>
                          <span className="sim-event-actor">{name}</span>
                          <span className="sim-event-kind">{SIM_EVENT_LABEL[ev.kind]}</span>
                          <button className="ol-btn" title="采纳到时间线（走提案）" onClick={() => adoptToTimeline(ev.content)}>落时间线</button>
                        </div>
                        <div className="sim-event-content">{ev.content}</div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* 角色面板 */}
              <div className="sim-actors">
                <div className="sim-actors-title">角色卡（人格词 / 模型 / 策略 / 经历记忆）</div>
                {active.actors.map((a) => {
                  const model = models.find((m) => m.id === a.modelId);
                  return (
                    <div key={a.id} className="sim-actor-card">
                      <div className="sim-actor-head">
                        <b>{a.entityId}</b>
                        <span className="sim-role">{SIM_ROLE_LABEL[a.role]}</span>
                        <select
                          value={a.modelId ?? ''}
                          onChange={(e) => updateActor(active.id, a.id, { modelId: e.target.value || undefined })}
                          title="角色专属模型（空=当前模型）"
                        >
                          <option value="">当前模型</option>
                          {models.map((m) => <option key={m.id} value={m.id}>{m.label}（{m.model}）</option>)}
                        </select>
                        <button
                          className="sim-strategy"
                          onClick={() => updateActor(active.id, a.id, { strategy: a.strategy === 'autonomous' ? 'on-command' : 'autonomous' })}
                          title="切换自主行动/等待指令"
                        >
                          {a.strategy === 'autonomous' ? '自主' : '待令'}
                        </button>
                      </div>
                      <textarea
                        rows={2}
                        value={a.personaPrompt}
                        onChange={(e) => updateActor(active.id, a.id, { personaPrompt: e.target.value })}
                        placeholder="人格与目标提示词（可编辑）"
                      />
                      {a.memorySlot.length > 0 && (
                        <div className="sim-memory">
                          <span className="tip">经历记忆（{a.memorySlot.length}）</span>
                          <ul>{a.memorySlot.map((m, i) => <li key={i}>{m}</li>)}</ul>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
