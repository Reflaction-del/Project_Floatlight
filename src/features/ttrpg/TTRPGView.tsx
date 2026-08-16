// ============================================================
// 跑团视图 TTRPGView（Phase 4a 单机 AI-GM）
// ------------------------------------------------------------
// 会话管理（规则书选择/玩家）· 回合日志（GM/玩家/判定着色）·
// 行动输入（自由文本 + /roll 掷骰 + /check 技能 难度检定）·
// 玩家属性面板（attrs/skills 编辑）· 规则书管理（内置骨架 + 用户
// .fugurule 导入导出 + 检定公式可编辑）· LAN 房间区（Phase 4b 预留）。
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { useWorldStore } from '../../store/worldStore';
import { useAIStore } from '../../store/aiStore';
import { trace } from '../agent/trace';
import { BUILTIN_RULEBOOKS, findBuiltinRulebook } from './rules';
import { serializeRulebook, deserializeRulebook, rulebookFilename } from './fugurule';
import { runGMAction } from './runtime';
import { TTRPG_MODE_LABEL, type Rulebook, type SessionTurn, type TTRPGSession } from './types';
import { storage } from '../../storage';
import { lanPeer } from './lan/peer';
import type { LanHostInfo } from './lan/peer';
import { buildJoinedPayload, makeRoomCode, mergeTurns, validatePeerName } from './lan/lanClient';

export function TTRPGView() {
  const sessions = useWorldStore((s) => s.worldsData[s.current]?.ttrpgSessions ?? []);
  const userRulebooks = useWorldStore((s) => s.worldsData[s.current]?.rulebooks ?? []);
  const world = useWorldStore((s) => s.worldsData[s.current]);
  const addSession = useWorldStore((s) => s.addTTRPGSession);
  const updateSession = useWorldStore((s) => s.updateTTRPGSession);
  const deleteSession = useWorldStore((s) => s.deleteTTRPGSession);
  const addRulebook = useWorldStore((s) => s.addRulebook);
  const updateRulebook = useWorldStore((s) => s.updateRulebook);
  const deleteRulebook = useWorldStore((s) => s.deleteRulebook);
  const models = useAIStore((s) => s.models);

  const [activeId, setActiveId] = useState<string | null>(null);
  const active = sessions.find((s) => s.id === activeId) ?? sessions[0] ?? null;

  // 规则书 = 内置骨架 + 用户导入
  const allRulebooks = useMemo(() => [...BUILTIN_RULEBOOKS, ...userRulebooks], [userRulebooks]);

  // —— 新建会话 ——
  const [showCreate, setShowCreate] = useState(false);
  const [cTitle, setCTitle] = useState('未命名跑团');
  const [cRulebookId, setCRulebookId] = useState(BUILTIN_RULEBOOKS[0].id);
  const [cPlayers, setCPlayers] = useState('林夜');

  // —— 行动 ——
  const [action, setAction] = useState('');
  const [running, setRunning] = useState(false);
  const [gmModelId, setGmModelId] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  // —— LAN 多人（Phase 4b）——
  const [lanOpen, setLanOpen] = useState(false);
  const [lanRole, setLanRole] = useState<'off' | 'host' | 'client'>('off');
  const [lanHost, setLanHost] = useState<LanHostInfo | null>(null);
  const [lanRemote, setLanRemote] = useState<string[]>([]);
  const [lanConn, setLanConn] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [lanErr, setLanErr] = useState('');
  const [jUrl, setJUrl] = useState('');
  const [jRoom, setJRoom] = useState('');
  const [jToken, setJToken] = useState('');
  const [jName, setJName] = useState('');
  const [ccTitle, setCCTitle] = useState('');
  const [cRulebookName, setCRulebookName] = useState('');
  const [ccPlayers, setCCPlayers] = useState<string[]>([]);
  const [cLog, setCLog] = useState<SessionTurn[]>([]);
  const [cAction, setCAction] = useState('');
  const activeIdRef = useRef<string | null>(null);
  const gmModelIdRef = useRef(gmModelId);
  const lanRoleRef = useRef<'off' | 'host' | 'client'>('off');

  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  useEffect(() => { gmModelIdRef.current = gmModelId; }, [gmModelId]);
  useEffect(() => { lanRoleRef.current = lanRole; }, [lanRole]);

  // —— 规则书管理 ——
  const [rulebookPanel, setRulebookPanel] = useState(false);
  const [rbName, setRbName] = useState('');
  const [rbMeta, setRbMeta] = useState('');
  const [editRbId, setEditRbId] = useState<string | null>(null);

  const doCreate = () => {
    const players = cPlayers.split(/[,，\s]+/).map((n) => n.trim()).filter(Boolean).map((name) => ({ name, state: {} }));
    if (players.length === 0) { alert('请至少输入一位玩家'); return; }
    const id = addSession({ mode: 'ai-gm', title: cTitle || '未命名跑团', rulebookId: cRulebookId, players });
    setActiveId(id);
    setShowCreate(false);
  };

  const sendAction = async () => {
    if (!active || !world || running) return;
    const rulebook = findBuiltinRulebook(active.rulebookId) ?? userRulebooks.find((r) => r.id === active.rulebookId);
    if (!rulebook) { alert('规则书不存在'); return; }
    const text = action.trim();
    if (!text) return;
    setAction('');
    setRunning(true);
    abortRef.current = new AbortController();
    const runId = trace.isEnabled()
      ? trace.startRun({ worldKey: useWorldStore.getState().current, source: 'chat', title: `跑团：${active.title}` })
      : '';
    try {
      const result = await runGMAction({
        session: active, rulebook, world, action: text, playerName: active.players[0]?.name ?? '玩家',
        gmModelId: gmModelId || undefined, signal: abortRef.current.signal, traceRunId: runId,
      });
      if (result.session !== active) updateSession(active.id, result.session);
      // 房主：本地行动结果广播给所有远程玩家
      if (lanRoleRef.current === 'host' && result.session !== active) {
        const newTurns = result.session.log.slice(active.log.length);
        if (newTurns.length) void lanPeer.broadcast({ type: 'turns', turns: newTurns });
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
      if (runId) trace.finishRun(runId);
    }
  };

  const stopRun = () => { abortRef.current?.abort(); setRunning(false); };

  // —— LAN 多人（Phase 4b）——
  /** 房主收到远程玩家行动：判定 + 广播新增回合 */
  const runRemoteAction = async (name: string, text: string) => {
    const st = useWorldStore.getState();
    const wd = st.worldsData[st.current];
    if (!wd) return;
    const sess = wd.ttrpgSessions.find((s) => s.id === activeIdRef.current) ?? wd.ttrpgSessions[0];
    if (!sess) return;
    const rb = findBuiltinRulebook(sess.rulebookId) ?? wd.rulebooks.find((r) => r.id === sess.rulebookId);
    if (!rb) return;
    try {
      const result = await runGMAction({ session: sess, rulebook: rb, world: wd, action: text, playerName: name, gmModelId: gmModelIdRef.current || undefined });
      if (result.session !== sess) st.updateTTRPGSession(sess.id, result.session);
      const newTurns = result.session.log.slice(sess.log.length);
      if (newTurns.length) void lanPeer.broadcast({ type: 'turns', turns: newTurns });
    } catch { /* 忽略远程行动失败 */ }
  };

  const hostStart = async () => {
    try {
      const room = makeRoomCode();
      const token = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
      const info = await lanPeer.startHost(room, token);
      setLanHost(info);
      setLanRole('host');
      if (active) updateSession(active.id, { lan: { roomCode: info.roomCode, token: info.token, port: info.port } });
    } catch (e: any) {
      alert(String(e?.message ?? e));
    }
  };

  const hostStop = async () => {
    await lanPeer.stopHost();
    setLanRole('off');
    setLanHost(null);
    setLanRemote([]);
    if (active?.lan) updateSession(active.id, { lan: undefined });
  };

  const joinRoom = async () => {
    if (!jUrl.trim() || !jRoom.trim() || !jToken.trim()) { setLanErr('请填写房主地址、房间码与令牌'); return; }
    const err = validatePeerName(jName, []);
    if (err) { setLanErr(err); return; }
    setLanConn('connecting');
    setLanErr('');
    try {
      await lanPeer.join(jUrl.trim(), jRoom.trim(), jToken.trim(), jName.trim());
      setLanRole('client');
      setLanConn('connected');
    } catch (e: any) {
      setLanConn('error');
      setLanErr(String(e?.message ?? e));
      lanPeer.leave();
    }
  };

  const leaveRoom = () => {
    lanPeer.leave();
    setLanRole('off');
    setLanConn('idle');
    setCLog([]);
    setCCPlayers([]);
    setLanErr('');
  };

  const sendClientAction = () => {
    const text = cAction.trim();
    if (!text) return;
    lanPeer.send({ type: 'action', name: lanPeer.selfName, text });
    const t: SessionTurn = {
      id: `ln-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      ts: Date.now(), kind: 'player', who: lanPeer.selfName, content: text,
    };
    setCLog((prev) => mergeTurns(prev, [t]));
    setCAction('');
  };

  // LAN 事件路由（注册一次，读 ref 取最新状态）
  useEffect(() => {
    lanPeer.onEvent((ev) => {
      if (ev.event === 'message' && ev.payload) {
        const p = ev.payload;
        if (lanRoleRef.current === 'host') {
          if (p.type === 'hello' && ev.name) {
            const st = useWorldStore.getState();
            const wd = st.worldsData[st.current];
            const sess = wd?.ttrpgSessions.find((s) => s.id === activeIdRef.current) ?? wd?.ttrpgSessions[0] ?? null;
            const rb = sess
              ? (findBuiltinRulebook(sess.rulebookId) ?? (wd?.rulebooks ?? []).find((r) => r.id === sess.rulebookId))
              : null;
            const players = [...(sess?.players.map((x) => x.name) ?? []), ...lanPeer.remotePlayers.filter((n) => n !== ev.name)];
            void lanPeer.sendTo(ev.name, buildJoinedPayload({ players, log: sess?.log ?? [], title: sess?.title ?? '', rulebookName: rb?.name ?? sess?.rulebookId ?? '' }));
            void lanPeer.broadcast({ type: 'player-joined', name: ev.name }, ev.name);
            setLanRemote([...lanPeer.remotePlayers]);
          } else if (p.type === 'action') {
            void runRemoteAction(p.name, p.text);
          }
        } else if (lanRoleRef.current === 'client') {
          if (p.type === 'joined') {
            setCCTitle(p.title);
            setCRulebookName(p.rulebookName);
            setCCPlayers(p.players);
            setCLog(p.log);
          } else if (p.type === 'player-joined') {
            setCCPlayers((prev) => (prev.includes(p.name) ? prev : [...prev, p.name]));
          } else if (p.type === 'player-left') {
            setCCPlayers((prev) => prev.filter((n) => n !== p.name));
          } else if (p.type === 'turns') {
            setCLog((prev) => mergeTurns(prev, p.turns));
          } else if (p.type === 'error') {
            alert(p.message);
          }
        }
      } else if (ev.event === 'close' && lanRoleRef.current === 'client') {
        setLanRole('off');
        setLanConn('idle');
        setLanErr('与房主连接已断开');
      }
    });
  }, []);

  // —— 规则书：导入（文件/粘贴）/ 导出 / 新建 ——
  const onImportFile = async () => {
    const res = await (storage as any).pickImport?.();
    if (!res) return;
    const { rulebook, error } = deserializeRulebook(res.content);
    if (error || !rulebook) { alert(`导入失败：${error}`); return; }
    addRulebook(rulebook);
    alert(`已导入规则书「${rulebook.name}」`);
  };
  const onExport = (rb: Rulebook) => {
    const content = serializeRulebook(rb);
    if (storage.isNative()) storage.exportFile(rulebookFilename(rb.name), content);
    else {
      const blob = new Blob([content], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = rulebookFilename(rb.name); a.click();
      URL.revokeObjectURL(a.href);
    }
  };
  const createCustomRulebook = () => {
    if (!rbName.trim()) { alert('请输入规则书名'); return; }
    addRulebook({
      id: '',
      name: rbName.trim(),
      universe: 'custom',
      dice: '1d20',
      stats: ['力量', '敏捷', '智力'],
      skills: [{ name: '技艺', base: '敏捷' }],
      formula: '1d20+{attr}+{skill}',
      difficulty: { easy: 10, normal: 15, hard: 20 },
      meta: rbMeta.trim(),
    });
    setRbName(''); setRbMeta('');
    alert('已创建自定义规则书（可在下方编辑检定公式）');
  };

  const activeRulebook = active ? findBuiltinRulebook(active.rulebookId) ?? userRulebooks.find((r) => r.id === active.rulebookId) : null;

  // 客户端（远程玩家）视图：只读同步房主日志，行动发房主判定
  const clientView = (
    <div className="sim-body sim-body-client">
      <div className="sim-list">
        <div className="sim-item active">
          <div className="sim-item-title">{ccTitle || '远程跑团'}</div>
          <div className="sim-item-meta">{cRulebookName} · 玩家 {ccPlayers.join(' / ') || '—'}</div>
        </div>
        <div className="sim-item-meta tip" style={{ padding: '4px 10px' }}>你是「{lanPeer.selfName}」：行动发送到房主判定，结果回传展示</div>
      </div>
      <div className="sim-main">
        <div className="sim-events">
          {cLog.length === 0 ? (
            <div className="sim-empty">已连接房主，等待开局…</div>
          ) : (
            cLog.map((t) => (
              <div key={t.id} className={'tt-turn tt-' + t.kind}>
                <div className="sim-event-head">
                  <span className="sim-event-actor">{t.who}</span>
                  <span className="sim-event-kind">{t.kind === 'gm' ? 'GM' : t.kind === 'roll' ? '判定' : t.kind === 'system' ? '系统' : '玩家'}</span>
                </div>
                <div className="sim-event-content">{t.content}</div>
                {t.detail && <pre className="tt-detail">{t.detail}</pre>}
              </div>
            ))
          )}
        </div>
        <div className="copilot-foot">
          <div className="co-foot-row">
            <input
              value={cAction}
              onChange={(e) => setCAction(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') sendClientAction(); }}
              placeholder="你的行动…（发送到房主）"
            />
            <button className="mode-btn active" onClick={sendClientAction} disabled={!cAction.trim()}>行动</button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="ttrpg-view">
      <div className="sim-head">
        <h3>跑团</h3>
        <span className="tip">AI 主持：输入自由行动，或用 /roll 1d20+3 掷骰、/check 运动 困难 检定</span>
        <button className="mode-btn active" onClick={() => setShowCreate((v) => !v)}>{showCreate ? '收起' : '+ 新建跑团'}</button>
        <button className="mode-btn" onClick={() => setRulebookPanel((v) => !v)}>规则书</button>
        <button className={'mode-btn' + (lanOpen ? ' active' : '')} onClick={() => setLanOpen((v) => !v)}>LAN 多人</button>
      </div>

      {lanOpen && (
        <div className="ttrpg-lan-panel">
          {lanRole === 'off' && (
            <>
              <div className="sim-form-row">
                <button className="mode-btn active" onClick={hostStart}>创建 LAN 房间（房主）</button>
                <span className="tip">房主共享此世界数据；远程玩家安装浮光应用，用下方信息加入；判定统一在房主进行</span>
              </div>
              <div className="sim-form-row">
                <input value={jUrl} onChange={(e) => setJUrl(e.target.value)} placeholder="房主地址 ws://192.168.x.x:端口" style={{ width: 250 }} />
                <input value={jRoom} onChange={(e) => setJRoom(e.target.value)} placeholder="房间码" style={{ width: 100 }} />
                <input value={jToken} onChange={(e) => setJToken(e.target.value)} placeholder="令牌" style={{ width: 150 }} />
                <input value={jName} onChange={(e) => setJName(e.target.value)} placeholder="玩家名" style={{ width: 110 }} />
                <button className="mode-btn" onClick={joinRoom} disabled={lanConn === 'connecting'}>{lanConn === 'connecting' ? '连接中…' : '加入房间'}</button>
              </div>
              {lanErr && <div className="ttrpg-lan-err">{lanErr}</div>}
              <p className="tip">安全说明：房间仅局域网可达，握手需 房间码+令牌；令牌与会话数据只在房主本机。</p>
            </>
          )}
          {lanRole === 'host' && lanHost && (
            <div className="sim-form-row">
              <b className="ttrpg-lan-code">房间码 {lanHost.roomCode}</b>
              <span className="tip">地址 ws://{lanHost.ips[0] ?? '本机IP'}:{lanHost.port} · 令牌 {lanHost.token.slice(0, 6)}…（完整令牌在创建结果中，复制给玩家）</span>
              <span className="tip">远程玩家：{lanRemote.length ? lanRemote.join(' / ') : '（暂无）'}</span>
              <button className="mode-btn danger" onClick={hostStop}>停止房间</button>
            </div>
          )}
          {lanRole === 'client' && (
            <div className="sim-form-row">
              <b className="ttrpg-lan-code">已加入：{ccTitle || '远程跑团'}</b>
              <span className="tip">角色：{lanPeer.selfName} · 玩家 {ccPlayers.join(' / ')}</span>
              <button className="mode-btn danger" onClick={leaveRoom}>离开</button>
            </div>
          )}
        </div>
      )}

      {showCreate && (
        <div className="sim-create">
          <div className="sim-form-row">
            <label>标题 <input value={cTitle} onChange={(e) => setCTitle(e.target.value)} /></label>
            <label>规则书
              <select value={cRulebookId} onChange={(e) => setCRulebookId(e.target.value)}>
                {allRulebooks.map((rb) => <option key={rb.id} value={rb.id}>{rb.name}</option>)}
              </select>
            </label>
            <label>玩家（逗号分隔）<input value={cPlayers} onChange={(e) => setCPlayers(e.target.value)} style={{ width: 140 }} /></label>
          </div>
          <button className="mode-btn active" onClick={doCreate}>创建</button>
        </div>
      )}

      {rulebookPanel && (
        <div className="ttrpg-rb-panel">
          <div className="sim-form-row">
            <label>新建自定义规则书：<input value={rbName} onChange={(e) => setRbName(e.target.value)} placeholder="规则书名" style={{ width: 140 }} /></label>
            <input value={rbMeta} onChange={(e) => setRbMeta(e.target.value)} placeholder="规则说明（可选）" style={{ flex: 1, minWidth: 160 }} />
            <button className="mode-btn" onClick={createCustomRulebook}>创建</button>
            <button className="mode-btn" onClick={onImportFile}>导入 .fugurule</button>
          </div>
          <div className="ttrpg-rb-list">
            {allRulebooks.map((rb) => (
              <div key={rb.id} className="ttrpg-rb-item">
                <b>{rb.name}</b>
                <span className="tip">{rb.universe} · {rb.dice} · 检定：{rb.formula}</span>
                {rb.universe !== 'custom' && !userRulebooks.find((u) => u.id === rb.id) ? (
                  <span className="tip">（内置骨架，不持久化）</span>
                ) : (
                  <>
                    <button className="ol-btn" title="编辑检定公式" onClick={() => setEditRbId(editRbId === rb.id ? null : rb.id)}>✎</button>
                    <button className="ol-btn" title="导出" onClick={() => onExport(rb)}>⇩</button>
                    <button className="ol-btn danger" title="删除" onClick={() => { if (confirm(`删除规则书「${rb.name}」？`)) deleteRulebook(rb.id); }}>×</button>
                  </>
                )}
                {editRbId === rb.id && (
                  <div className="ttrpg-rb-edit">
                    <label>{'检定公式（{attr} / {skill} 变量，如 1d20+{attr}+{skill} 或 1d100<=({skill}*5)）'}</label>
                    <input value={rb.formula} onChange={(e) => updateRulebook(rb.id, { formula: e.target.value })} />
                    <label>难度表（key=值，逗号分隔）</label>
                    <input
                      value={Object.entries(rb.difficulty).map(([k, v]) => `${k}=${v}`).join(',')}
                      onChange={(e) => {
                        const diff: Record<string, number> = {};
                        e.target.value.split(/[,，]/).forEach((pair) => {
                          const [k, v] = pair.split('=');
                          if (k && v) diff[k.trim()] = Number(v) || 0;
                        });
                        updateRulebook(rb.id, { difficulty: diff });
                      }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="tip">版权提示：DND5e / COC7 等商业 IP 的完整规则请以 .fugurule 导入（用户自有内容，仅本地存储）；内置仅为可运行的规则骨架。</p>
        </div>
      )}

      {lanRole === 'client' ? clientView : sessions.length === 0 ? (
        <div className="sim-empty">
          <p>还没有跑团会话。点「新建跑团」选择规则书开始一场 AI 主持的冒险。</p>
          <div className="tip">指令示例：/roll 1d20+3（掷骰）｜ /check 侦查 困难（技能检定，需在玩家面板配属性）</div>
        </div>
      ) : (
        <div className="sim-body">
          <div className="sim-list">
            {sessions.map((s) => (
              <div key={s.id} className={'sim-item' + (active?.id === s.id ? ' active' : '')} onClick={() => setActiveId(s.id)}>
                <div className="sim-item-title">{s.title}</div>
                <div className="sim-item-meta">{TTRPG_MODE_LABEL[s.mode]} · {s.players.length} 人 · {s.log.length} 回合</div>
              </div>
            ))}
            {active && (
              <button className="ol-btn danger" style={{ marginTop: 8 }} onClick={() => { if (confirm(`删除跑团「${active.title}」？`)) deleteSession(active.id); }}>删除当前</button>
            )}
          </div>

          {!active ? null : (
            <div className="sim-main">
              <div className="sim-controls">
                <span className="sim-mode-tag">{TTRPG_MODE_LABEL[active.mode]}</span>
                <span className="tip">规则书：{activeRulebook?.name ?? active.rulebookId}</span>
                <select value={gmModelId} onChange={(e) => setGmModelId(e.target.value)} title="GM 专属模型">
                  <option value="">GM 用当前模型</option>
                  {models.map((m) => <option key={m.id} value={m.id}>{m.label}（{m.model}）</option>)}
                </select>
                {active.lan && <span className="tip">LAN 房间：{active.lan.roomCode}（Phase 4b）</span>}
              </div>

              <div className="sim-events">
                {active.log.length === 0 ? (
                  <div className="sim-empty">开局。输入玩家行动开始跑团。</div>
                ) : (
                  active.log.map((t) => (
                    <div key={t.id} className={'tt-turn tt-' + t.kind}>
                      <div className="sim-event-head">
                        <span className="sim-event-actor">{t.who}</span>
                        <span className="sim-event-kind">{t.kind === 'gm' ? 'GM' : t.kind === 'roll' ? '判定' : t.kind === 'system' ? '系统' : '玩家'}</span>
                      </div>
                      <div className="sim-event-content">{t.content}</div>
                      {t.detail && <pre className="tt-detail">{t.detail}</pre>}
                    </div>
                  ))
                )}
              </div>

              {/* 玩家属性面板 */}
              <div className="sim-actors">
                <div className="sim-actors-title">玩家属性（检定用 attrs/skills 值）</div>
                {active.players.map((p) => {
                  const state = (active.state[p.name] ?? {}) as { attrs?: Record<string, number>; skills?: Record<string, number> };
                  return (
                    <div key={p.name} className="tt-player-card">
                      <b>{p.name}</b>
                      <label className="tip">属性（{activeRulebook?.stats.join('/') ?? '力量/敏捷'}）</label>
                      <input
                        value={Object.entries(state.attrs ?? {}).map(([k, v]) => `${k}:${v}`).join(',')}
                        placeholder="力量:3,敏捷:2"
                        onChange={(e) => {
                          const attrs: Record<string, number> = {};
                          e.target.value.split(/[,，]/).forEach((pair) => {
                            const [k, v] = pair.split(':');
                            if (k && v) attrs[k.trim()] = Number(v) || 0;
                          });
                          updateSession(active.id, { state: { ...active.state, [p.name]: { ...state, attrs } } });
                        }}
                      />
                      <label className="tip">技能（{activeRulebook?.skills.map((s) => s.name).join('/') ?? '技能'}）</label>
                      <input
                        value={Object.entries(state.skills ?? {}).map(([k, v]) => `${k}:${v}`).join(',')}
                        placeholder="运动:2,侦查:12"
                        onChange={(e) => {
                          const skills: Record<string, number> = {};
                          e.target.value.split(/[,，]/).forEach((pair) => {
                            const [k, v] = pair.split(':');
                            if (k && v) skills[k.trim()] = Number(v) || 0;
                          });
                          updateSession(active.id, { state: { ...active.state, [p.name]: { ...state, skills } } });
                        }}
                      />
                    </div>
                  );
                })}
              </div>

              <div className="copilot-foot">
                <div className="co-foot-row">
                  <input
                    value={action}
                    onChange={(e) => setAction(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !running) sendAction(); }}
                    placeholder={running ? 'GM 回应中…' : '玩家行动…（/roll 1d20+3 · /check 运动 困难）'}
                    disabled={running}
                  />
                  {running ? <button className="co-stop-btn" onClick={stopRun}>停止</button> : <button className="mode-btn active" onClick={sendAction} disabled={!action.trim()}>行动</button>}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
