// ============================================================
// 聊天接入设置区（Phase 3.5）
// ------------------------------------------------------------
// 本地桥接 API 管理：启用开关 / 端口与令牌（复制/轮换）/
// 整理模式（AI 结构化 / 原文直存）/ 测试发送 / curl 参考用例 /
// 最近接入日志。
// ============================================================

import { useEffect, useState } from 'react';
import { useWorldStore } from '../../store/worldStore';
import { processInspiration, getBridgeMode, setBridgeMode } from './bridgeHandler';
import { getCurrentModel } from '../../utils/ai';

interface BridgeStatus { enabled: boolean; port: number; token: string }

const CURL_TEMPLATE = `curl -X POST http://127.0.0.1:{port}/api/v1/inspiration \\
  -H "Authorization: Bearer {token}" \\
  -H "Content-Type: application/json" \\
  -d '{"platform":"qq","chatId":"group1","userId":"u1","nickname":"小林","text":"灵感消息内容"}'
# 返回: {"ok":true,"draftId":"df-...","mode":"structured","summary":"...","outlineHint":{...}}`;

export function BridgeSettingsSection() {
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [mode, setMode] = useState<'structured' | 'raw'>(() => getBridgeMode());
  const [copied, setCopied] = useState(false);
  const [testMsg, setTestMsg] = useState('想到一个设定：夜行者协会在星陨之夜后接管了城邦的守夜职责。');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string>('');
  const bridgeLog = useWorldStore((s) => s.worldsData[s.current]?.bridgeLog ?? []);
  const refreshLog = useWorldStore((s) => s.worldsData[s.current]?.bridgeLog?.length ?? 0);
  void refreshLog; // 订阅日志变化

  useEffect(() => {
    const api = (window as any).api;
    if (!api?.bridgeGetStatus) return; // 浏览器环境无桥接
    api.bridgeGetStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  const applyEnabled = async (v: boolean) => {
    const api = (window as any).api;
    if (!api?.bridgeSetEnabled) return;
    const enabled = await api.bridgeSetEnabled(v);
    setStatus((s) => (s ? { ...s, enabled } : s));
  };
  const rotate = async () => {
    const api = (window as any).api;
    if (!api?.bridgeRotateToken) return;
    const token = await api.bridgeRotateToken();
    setStatus((s) => (s ? { ...s, token } : s));
  };
  const copyToken = async () => {
    if (!status?.token) return;
    try {
      await navigator.clipboard.writeText(status.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  const testSend = async () => {
    if (!testMsg.trim() || testing) return;
    setTesting(true);
    setTestResult('');
    try {
      const r = await processInspiration({
        platform: 'webhook', chatId: 'test', userId: 'tester', nickname: '测试', text: testMsg.trim(),
      });
      setTestResult(JSON.stringify(r, null, 2));
    } catch (e: any) {
      setTestResult(String(e?.message ?? e));
    } finally {
      setTesting(false);
    }
  };

  const curl = CURL_TEMPLATE
    .split('{port}').join(String(status?.port ?? 'PORT'))
    .split('{token}').join(status?.token ?? 'TOKEN');

  return (
    <section className="set-section">
      <h3>聊天接入（灵感 → 草稿箱）</h3>
      <p className="tip">
        浮光暴露本地 HTTP API（仅回环 127.0.0.1 + Bearer 令牌），由外部机器人框架（AstrBot 等）转发聊天消息。
        收到的灵感自动整理进草稿箱；平台适配在外部完成，本接口平台无关（qq / wechat / telegram / webhook）。
      </p>

      <div className="set-bridge-row">
        <label className="set-bridge-switch">
          <input type="checkbox" checked={status?.enabled ?? false} onChange={(e) => applyEnabled(e.target.checked)} disabled={!status} />
          启用桥接服务
        </label>
        {status && (
          <span className="tip">端口：<code>{status.port}</code>（127.0.0.1）</span>
        )}
        {!status && <span className="tip">（浏览器环境无桥接服务，仅桌面版可用）</span>}
      </div>

      {status && (
        <div className="set-bridge-row">
          <span className="tip">令牌：</span>
          <code className="set-bridge-token">{status.token.slice(0, 12)}…{status.token.slice(-6)}</code>
          <button className="mode-btn" onClick={copyToken}>{copied ? '已复制' : '复制'}</button>
          <button className="mode-btn" onClick={rotate}>轮换令牌</button>
        </div>
      )}

      <div className="set-bridge-row">
        <span className="tip">整理模式：</span>
        <label><input type="radio" checked={mode === 'structured'} onChange={() => { setMode('structured'); setBridgeMode('structured'); }} /> AI 结构化（标题/摘要/标签/大纲推荐）</label>
        <label><input type="radio" checked={mode === 'raw'} onChange={() => { setMode('raw'); setBridgeMode('raw'); }} /> 原文直存（零 AI 成本）</label>
      </div>

      <div className="set-bridge-row">
        <button className="mode-btn" onClick={testSend} disabled={testing || !testMsg.trim()}>
          {testing ? '测试中…' : '测试发送'}
        </button>
        <input
          value={testMsg}
          onChange={(e) => setTestMsg(e.target.value)}
          style={{ flex: 1, minWidth: 180, padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 6, background: 'transparent', color: 'inherit', fontSize: 12.5 }}
        />
      </div>
      {testResult && <pre className="set-bridge-result">{testResult}</pre>}

      <h4>参考用例（curl，第一版接入方式）</h4>
      <pre className="set-bridge-curl">{curl}</pre>
      <p className="tip">外部框架插件只需按此格式 POST 消息；响应含 summary 与 outlineHint，机器人可回传用户「已整理到草稿箱 + 摘要」。</p>

      <h4>接入日志（最近 {bridgeLog.length} 条）</h4>
      {bridgeLog.length === 0 ? (
        <p className="tip">暂无接入记录。收到灵感消息后这里会留痕。</p>
      ) : (
        <div className="set-bridge-log">
          {[...bridgeLog].slice(-10).reverse().map((e) => (
            <div key={e.id} className="set-bridge-log-item">
              <span className="tip">{e.nickname || e.platform} · {new Date(e.ts).toLocaleTimeString()} · {e.mode === 'structured' ? '结构化' : '直存'}</span>
              <div className="set-bridge-log-text">{e.text.slice(0, 80)}{e.text.length > 80 ? '…' : ''}</div>
              {e.outlineHint && <span className="tip">→ 大纲推荐：{e.outlineHint.title}</span>}
              {e.error && <span className="tip" style={{ color: 'var(--danger)' }}>失败：{e.error}</span>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
