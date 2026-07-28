import { useState, useEffect } from 'react';
import { validateModelName } from '../../utils/ai';
import { useThemeStore } from '../../store/themeStore';
import { useAIStore, type AIModel, type EmbeddingModel, type IndexMode, getModelDefaults, DEFAULT_INDEX_POLICY } from '../../store/aiStore';
import { useWorldStore } from '../../store/worldStore';
import { useWorldviewStore } from '../../store/worldviewStore';
import { useUIStore } from '../../store/uiStore';
import { getStartPageEnabled, setStartPageEnabled } from './startPageSetting';
import { storage } from '../../storage';
import { AIUsagePanel } from './AIUsagePanel';
import { worldToMarkdown } from '../../utils/markdown';
import { testConnection, listModels, embedTexts } from '../../utils/ai';
import { rebuildIndexDelta, clearIndex, getIndexStats } from '../../utils/embeddingIndex';
import type { ThemeMode } from '../../types';
import { appPrefs, useAppPrefs, paletteAccentFor, type WindowEffect, type GradientPreset, type TitleBarMode } from '../../store/appPrefs';
import { useKeymapStore, ACTION_META, formatCombo, eventToCombo, type KeymapAction } from '../../store/keymapStore';

/** 开始页开关（独立 localStorage，避免侵入其他 store） */
function useStartPageSetting(): [boolean, (v: boolean) => void] {
  const [val, setVal] = useState(() => getStartPageEnabled());
  const setter = (v: boolean) => {
    setVal(v);
    setStartPageEnabled(v);
    // 开关即时影响开始页标签的存在/移除
    useUIStore.getState().ensureStartPage();
  };
  return [val, setter];
}

const THEMES: { key: ThemeMode; label: string; icon: string }[] = [
  { key: 'light', label: '浅色', icon: '' },
  { key: 'dark', label: '深色', icon: '' },
  { key: 'warm', label: '护眼', icon: '' },
  { key: 'blue', label: '蓝调', icon: '' },
  { key: 'system', label: '跟随系统', icon: '' },
];

const PRESET_ACCENTS = ['#3b82f6', '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b', '#22c55e', '#10b981', '#06b6d4', '#a855f7', '#f97316', '#0ea5e9', '#0891b2', '#84cc16'];

const WINDOW_EFFECTS: { key: WindowEffect; label: string }[] = [
  { key: 'none', label: '无' },
  { key: 'aero', label: 'AERO' },
  { key: 'acrylic', label: '亚克力' },
  { key: 'mica', label: '云母' },
];

const GRADIENT_PRESETS: { key: GradientPreset; label: string; style?: string }[] = [
  { key: 'default', label: '默认' },
  { key: 'deep-sea', label: '深海', style: 'linear-gradient(135deg,#020617,#0f4c81,#22d3ee)' },
  { key: 'aurora', label: '极光', style: 'linear-gradient(135deg,#020617,#047857,#c084fc)' },
  { key: 'twilight', label: '暮光', style: 'linear-gradient(135deg,#1e1b4b,#a21caf,#fbbf24)' },
  { key: 'ember', label: '余烬', style: 'linear-gradient(135deg,#2a0505,#b91c1c,#fde047)' },
  { key: 'frost', label: '霜雪', style: 'linear-gradient(135deg,#0f172a,#2563eb,#bfdbfe)' },
  { key: 'custom', label: '自定义' },
];

const TITLEBAR_MODES: { key: TitleBarMode; label: string }[] = [
  { key: 'system', label: '系统标题栏' },
  { key: 'custom', label: '自建标题栏' },
];

function newModelId() {
  return 'm-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function SettingsView() {
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);
  const customAccent = useThemeStore((s) => (s as any).customAccent as string | undefined);
  const setCustomAccent = useThemeStore((s) => (s as any).setCustomAccent as (c: string | null) => void);
  const [showStartPage, setShowStartPage] = useStartPageSetting();
  const { windowEffect: eff, gradientPreset, customGradient, blurIntensity, titleBar } = useAppPrefs();

  const models = useAIStore((s) => s.models);
  const currentId = useAIStore((s) => s.currentId);
  const addModel = useAIStore((s) => s.addModel);
  const updateModel = useAIStore((s) => s.updateModel);
  const removeModel = useAIStore((s) => s.removeModel);
  const setCurrent = useAIStore((s) => s.setCurrent);

  const [editing, setEditing] = useState<AIModel | null>(null);
  const [testMsg, setTestMsg] = useState<Record<string, string>>({});
  const [fetchingList, setFetchingList] = useState<Record<string, boolean>>({});
  const [availableList, setAvailableList] = useState<Record<string, string[]>>({});

  // 嵌入模型（语义检索）草稿
  const [embedDraft, setEmbedDraft] = useState<EmbeddingModel | null>(useAIStore.getState().embeddingModel);
  const [embedMsg, setEmbedMsg] = useState<string>('');

  // 语义索引管理（手动更新 / 清除 / 自动策略）
  const [indexBusy, setIndexBusy] = useState<boolean>(false);
  const [indexMsg, setIndexMsg] = useState<string>('');
  const [indexStats, setIndexStats] = useState<{ count: number; updatedAt: number; sizeBytes: number } | null>(null);
  const [indexProgress, setIndexProgress] = useState<string>('');

  const refreshIndexStats = () => {
    const wid = useWorldStore.getState().current;
    setIndexStats(useAIStore.getState().embeddingModel ? getIndexStats(wid) : null);
  };
  useEffect(() => { refreshIndexStats(); /* eslint-disable-next-line */ }, [embedDraft]);

  const [saveDir, setSaveDir] = useState<string>('');
  const [saveDirLoading, setSaveDirLoading] = useState<boolean>(true);
  const [saveMsg, setSaveMsg] = useState<string>('');

  useEffect(() => {
    // 桌面版读取真实存储目录；浏览器预览回退 localStorage
    if (storage.isNative()) {
      storage.getSaveDir().then((d) => { if (d) { setSaveDir(d); setSaveDirLoading(false); } }).catch(() => { setSaveDirLoading(false); });
    } else {
      setSaveDirLoading(false);
      try { const s = localStorage.getItem('fl-save-dir'); if (s) setSaveDir(s); } catch { /* ignore */ }
    }
  }, []);

  const keymap = useKeymapStore((s) => s.keymap);
  const setAction = useKeymapStore((s) => s.setAction);
  const resetKeymap = useKeymapStore((s) => s.resetAll);
  const [capturing, setCapturing] = useState<KeymapAction | null>(null);
  useEffect(() => {
    if (!capturing) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { setCapturing(null); return; }
      const combo = eventToCombo(e);
      if (!combo) return; // 仅修饰键不记录
      const conflict = (Object.keys(keymap) as KeymapAction[]).find((a) => a !== capturing && keymap[a] === combo);
      if (conflict) {
        alert(`「${combo}」已被「${ACTION_META.find((m) => m.action === conflict)?.label ?? conflict}」占用，请换一个组合。`);
        setCapturing(null);
        return;
      }
      setAction(capturing, combo);
      setCapturing(null);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [capturing, keymap]);

  const startNew = () => setEditing({ id: newModelId(), label: '', endpoint: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini', ...getModelDefaults() } as AIModel);
  const startEdit = (m: AIModel) => setEditing({ ...m });
  const saveModel = () => {
    if (!editing) return;
    if (!editing.label.trim()) { alert('请填写别名'); return; }
    const nameErr = validateModelName(editing.model);
    if (nameErr) { if (!window.confirm(`模型名校验提示：\n${nameErr}\n\n是否仍要保存？`)) return; }
    if (models.find((m) => m.id === editing.id)) {
      updateModel(editing.id, editing);
    } else {
      addModel(editing);
      if (models.length === 0) setCurrent(editing.id);
    }
    setEditing(null);
  };
  const testThis = async (m: AIModel) => {
    setTestMsg((p) => ({ ...p, [m.id]: '测试中…' }));
    const r = await testConnection(m);
    const ok = r.length < 50 && !/error|fail/i.test(r);
    setTestMsg((p) => ({ ...p, [m.id]: ok ? '✓ 连接成功：' + r : '✗ ' + r }));
  };
  const fetchAvailable = async (m: AIModel) => {
    setFetchingList((p) => ({ ...p, [m.id]: true }));
    try {
      const list = await listModels(m);
      setAvailableList((p) => ({ ...p, [m.id]: list }));
    } catch (e: any) {
      setAvailableList((p) => ({ ...p, [m.id]: [] }));
      setTestMsg((p) => ({ ...p, [m.id]: '✗ ' + (e.message || '失败') }));
    }
    setFetchingList((p) => ({ ...p, [m.id]: false }));
  };

  const saveEmbed = () => {
    if (!embedDraft || !embedDraft.endpoint.trim() || !embedDraft.model.trim()) {
      setEmbedMsg('请填写端点与模型名');
      return;
    }
    useAIStore.getState().setEmbeddingModel({ ...embedDraft });
    setEmbedMsg('✓ 已保存嵌入模型');
  };
  const testEmbed = async () => {
    if (!embedDraft || !embedDraft.endpoint.trim() || !embedDraft.model.trim()) {
      setEmbedMsg('请先填写端点与模型名');
      return;
    }
    setEmbedMsg('测试中…');
    try {
      const v = await embedTexts(embedDraft, ['测试向量维度']);
      if (Array.isArray(v[0]) && v[0].length > 0) setEmbedMsg(`✓ 连接成功，向量维度 ${v[0].length}`);
      else setEmbedMsg('✗ 返回异常（无 embedding 向量）');
    } catch (e: any) {
      setEmbedMsg('✗ ' + (e.message || String(e)));
    }
  };

  /** 手动「立即索引 / 更新」：增量重建当前世界的语义索引 */
  const rebuildNow = async () => {
    const emb = useAIStore.getState().embeddingModel;
    if (!emb) { setIndexMsg('请先保存嵌入模型'); return; }
    const wid = useWorldStore.getState().current;
    const wd = useWorldStore.getState().worldsData[wid];
    if (!wd) { setIndexMsg('当前世界无数据'); return; }
    setIndexBusy(true);
    setIndexMsg('');
    setIndexProgress(`准备中（共 ${wd.entities?.length ?? 0} 个实体）…`);
    try {
      const r = await rebuildIndexDelta(wid, wd.entities ?? [], wd.relations ?? [], emb, {
        onProgress: (done, total) => setIndexProgress(`索引中 ${done}/${total}…`),
      });
      setIndexMsg(`✓ 索引完成：新增/更新 ${r.indexed} 个，复用 ${r.skipped} 个`);
      refreshIndexStats();
    } catch (e: any) {
      setIndexMsg('✗ ' + (e.message || String(e)));
    } finally {
      setIndexBusy(false);
      setIndexProgress('');
    }
  };

  /** 手动「清除索引」：删除当前世界的向量索引文件 */
  const clearIdx = () => {
    const emb = useAIStore.getState().embeddingModel;
    if (!emb) { setIndexMsg('请先保存嵌入模型'); return; }
    const wid = useWorldStore.getState().current;
    if (!confirm(`确定清除当前世界（${wid}）的语义索引吗？下次语义检索将重新生成。`)) return;
    clearIndex(wid);
    setIndexMsg('已清除索引');
    refreshIndexStats();
  };

  /** 切换自动索引模式（持久化到嵌入模型的 indexPolicy） */
  const setAutoMode = (mode: IndexMode) => {
    const emb = useAIStore.getState().embeddingModel;
    if (!emb) { setIndexMsg('请先保存嵌入模型'); return; }
    const policy = emb.indexPolicy ?? DEFAULT_INDEX_POLICY;
    // 不同模式采用不同默认防抖：实体变更=2s，保存时=5s
    const debounceMs = mode === 'onEntityChange' ? 2000 : mode === 'onSave' ? 5000 : policy.debounceMs;
    useAIStore.getState().setEmbeddingModel({ ...emb, indexPolicy: { mode, debounceMs } });
    setEmbedDraft({ ...emb, indexPolicy: { mode, debounceMs } });
    setIndexMsg(`自动索引模式：${mode === 'manual' ? '仅手动' : mode === 'onEntityChange' ? '实体变更后自动' : '保存时自动'}`);
  };

  const openFolder = async () => {
    if (storage.isNative()) {
      const d = await storage.openSaveDir();
      if (d) setSaveMsg('已打开 ' + d);
    } else {
      setSaveMsg('浏览器预览无法打开本地文件夹');
    }
  };

  const ensureDir = async () => {
    const dir = saveDir.trim();
    if (!dir) { setSaveMsg('请填写有效的目录路径'); return; }
    if (storage.isNative()) {
      setSaveMsg('正在切换并迁移数据…');
      const real = await storage.setSaveDir(dir);
      if (real) {
        // 把当前内存状态再写一遍，确保新目录包含最新数据（migrateSaveDir 已复制历史文件）
        storage.saveWorldsData(useWorldStore.getState().worldsData);
        storage.saveWorldview(useWorldviewStore.getState().worlds);
        storage.saveCurrent(useWorldviewStore.getState().current);
        storage.saveAI(useAIStore.getState().models, useAIStore.getState().currentId);
        setSaveMsg('✓ 已切换到 ' + real + '，应用将刷新以生效');
        // 刷新页面，让 main.tsx 从新的存储位置重新加载；避免内存中的旧路径继续被使用
        setTimeout(() => { try { window.location.reload(); } catch { setSaveMsg('✓ 已切换，请手动重启应用'); } }, 600);
      } else {
        setSaveMsg('✗ 目录切换失败');
      }
      return;
    }
    try { localStorage.setItem('fl-save-dir', dir); } catch { /* ignore */ }
    setSaveMsg('当前为浏览器预览，无法修改磁盘目录（仅桌面版生效）。');
  };

  return (
    <div className="editor-scroll">
      <div className="editor-wrap" style={{ maxWidth: 720 }}>
        <h2>设置</h2>

        <section className="set-section">
          <h3>外观</h3>
          <div className="set-themes">
            {THEMES.map((t) => (
              <button key={t.key} className={'set-theme' + (mode === t.key ? ' active' : '')} onClick={() => setMode(t.key)}>
                <span>{t.icon}</span>{t.label}
              </button>
            ))}
          </div>
          <div style={{ marginTop: 14 }}>
            <div className="tip" style={{ marginBottom: 6 }}>自定义主题色（应用到按钮/高亮/边线）</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <input type="color" value={customAccent || '#3b82f6'} onChange={(e) => setCustomAccent(e.target.value)} style={{ width: 44, height: 32, border: '1px solid var(--border)', borderRadius: 6, padding: 2, background: 'var(--bg)' }} />
              <input type="text" value={customAccent ?? ''} onChange={(e) => setCustomAccent(e.target.value || null)} placeholder="例如 #3b82f6" style={{ flex: '0 1 200px', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', background: 'var(--bg)', color: 'var(--fg)', fontSize: 13 }} />
              {customAccent && <button className="mode-btn" onClick={() => setCustomAccent(null)}>恢复默认</button>}
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {PRESET_ACCENTS.map((c) => (
                  <button key={c} className={'cp-swatch' + (customAccent === c ? ' active' : '')} onClick={() => setCustomAccent(c)} style={{ background: c, width: 22, height: 22, borderRadius: 4, border: '1px solid var(--border)', cursor: 'pointer' }} title={c} />
                ))}
              </div>
            </div>
          </div>
          <div className="set-row">
            <div className="set-row-label">
              <span className="set-row-title">窗口效果</span>
              <span className="tip">AERO / 亚克力 / 云母为半透明毛玻璃质感，仅桌面版生效；「无」则保持原版实色</span>
            </div>
            <div className="set-effect-opts">
              {WINDOW_EFFECTS.map((e) => (
                <button key={e.key} className={'mode-btn' + (eff === e.key ? ' active' : '')} onClick={() => appPrefs.setWindowEffect(e.key)}>{e.label}</button>
              ))}
            </div>
          </div>

          {eff !== 'none' && (
            <>
              <div className="set-row">
                <div className="set-row-label">
                  <span className="set-row-title">渐变配色</span>
                  <span className="tip">效果模式下的底层渐变背景</span>
                </div>
                <div className="set-gradient-opts">
                  {GRADIENT_PRESETS.map((g) => (
                    <button
                      key={g.key}
                      className={'set-gradient-btn' + (gradientPreset === g.key ? ' active' : '')}
                      onClick={() => {
                        appPrefs.setGradientPreset(g.key);
                        // 超级调色盘：非 default 配色同步染全局 accent
                        if (g.key !== 'default') {
                          const accent = paletteAccentFor({
                            windowEffect: eff,
                            gradientPreset: g.key,
                            customGradient,
                            blurIntensity,
                            titleBar,
                          });
                          if (accent) setCustomAccent(accent);
                        }
                      }}
                      title={g.label}
                    >
                      {g.style && <span className="set-gradient-swatch" style={{ background: g.style }} />}
                      <span>{g.label}</span>
                    </button>
                  ))}
                </div>
                {gradientPreset === 'custom' && (
                  <div className="set-gradient-custom">
                    {customGradient.map((c, i) => (
                      <input
                        key={i}
                        type="color"
                        value={c}
                        onChange={(e) => {
                          const next: [string, string, string] = [...customGradient] as [string, string, string];
                          next[i] = e.target.value;
                          appPrefs.setCustomGradient(next);
                          // 超级调色盘：自定义配色取中间节点染全局 accent
                          if (i === 1) setCustomAccent(e.target.value);
                        }}
                        title={`渐变节点 ${i + 1}`}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div className="set-row">
                <div className="set-row-label">
                  <span className="set-row-title">模糊强度</span>
                  <span className="tip">值越大毛玻璃越明显（{blurIntensity}%）</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={blurIntensity}
                  onChange={(e) => appPrefs.setBlurIntensity(Number(e.target.value))}
                  className="set-blur-slider"
                />
              </div>
            </>
          )}

          <div className="set-row">
            <div className="set-row-label">
              <span className="set-row-title">标题栏模式</span>
              <span className="tip">系统标题栏由 Windows 绘制；自建标题栏更贴合编辑器主题，切换后需重启应用</span>
            </div>
            <div className="set-effect-opts">
              {TITLEBAR_MODES.map((m) => (
                <button
                  key={m.key}
                  className={'mode-btn' + (titleBar === m.key ? ' active' : '')}
                  onClick={() => {
                    appPrefs.setTitleBar(m.key);
                    if (window.confirm('标题栏模式已更改，需要重启应用才能生效。\n\n是否立即重启？（未保存的改动已自动保存）')) {
                      try { (window as any).api?.winRelaunch?.(); } catch { /* ignore */ }
                    }
                  }}
                >{m.label}</button>
              ))}
            </div>
          </div>
          <div className="set-row">
            <div className="set-row-label">
              <span className="set-row-title">启动时显示开始页</span>
              <span className="tip">无打开文件时展示近期编辑列表与快捷操作</span>
            </div>
            {/* Fluent Toggle Switch */}
            <label className="fluent-toggle">
              <input
                type="checkbox"
                checked={showStartPage}
                onChange={(e) => setShowStartPage(e.target.checked)}
              />
              <span className="fluent-toggle-track">
                <span className="fluent-toggle-thumb" />
              </span>
            </label>
          </div>
        </section>

        <section className="set-section">
          <h3>大模型接入 (AI)</h3>
          <p className="tip">支持多个 OpenAI 兼容 API 模型（OpenAI / DeepSeek / LiteLLM / Ollama / LM Studio 等）。配置后会自动同步到侧边栏 AI。</p>
          <div className="set-ai-list">
            {models.length === 0 && <div className="tip" style={{ padding: 8 }}>尚未添加模型，点击下方"＋ 新增模型"配置第一个。</div>}
            {models.map((m) => (
              <div key={m.id} className={'set-ai-card' + (m.id === currentId ? ' active' : '')}>
                <div className="set-ai-card-head">
                  <span className="set-ai-card-icon">{m.id === currentId ? '●' : '○'}</span>
                  <span className="set-ai-card-title">{m.label || '(未命名)'}</span>
                  <span className="set-ai-card-model">[{m.model}{m.format && m.format !== 'chat' ? ' · ' + m.format : ""}]</span>
                  <div style={{ flex: 1 }} />
                  {m.id === currentId && <span className="tip" style={{ color: 'var(--accent)' }}>当前使用</span>}
                  <button className="mode-btn" onClick={() => { setCurrent(m.id); }}>设为当前</button>
                  <button className="mode-btn" onClick={() => startEdit(m)}>编辑</button>
                  <button className="mode-btn danger" onClick={() => { if (window.confirm(`删除模型"${m.label}"？`)) removeModel(m.id); }}>删除</button>
                </div>
                <div className="set-ai-card-detail">
                  <div><span className="tip">端点</span><code>{m.endpoint}</code></div>
                  <div><span className="tip">Key</span><code>{m.apiKey ? m.apiKey.slice(0, 6) + '•••' + m.apiKey.slice(-4) : '(空)'}</code></div>
                  <div><span className="tip">模型名</span><code>{m.model}</code></div>
                  <div className="set-ai-badges">
                    {m.supportsVision && <span className="set-ai-badge vision" title="支持视觉输入">视觉</span>}
                    {m.supportsThinking && <span className="set-ai-badge thinking" title="输出含推理过程">深度思考</span>}
                    {m.supportsWebSearch && <span className="set-ai-badge web" title={`联网搜索参数：${m.webSearchParam || '未指定'}`}>联网搜索{m.webSearchParam ? ` · ${m.webSearchParam}` : ''}</span>}
                    {m.requiresMetering && <span className="set-ai-badge meter" title="启用用量统计">计量</span>}
                    {!!m.contextWindow && <span className="set-ai-badge ctx" title="最大上下文窗口">{m.contextWindow.toLocaleString()} tokens</span>}
                  </div>
                </div>
                {testMsg[m.id] && <div className="tip" style={{ marginTop: 6, color: testMsg[m.id].startsWith('✓') ? 'var(--accent)' : 'var(--danger)' }}>{testMsg[m.id]}</div>}
                {availableList[m.id] && availableList[m.id].length > 0 && (
                  <div className="tip" style={{ marginTop: 6 }}>
                    该端点模型列表（点选填充到模型名）：{availableList[m.id].map((mm) => (
                      <button key={mm} className="mode-btn" style={{ marginLeft: 4, padding: '2px 6px', fontSize: 11 }} onClick={() => updateModel(m.id, { model: mm })}>{mm}</button>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <button className="mode-btn" onClick={() => testThis(m)}>测试连接</button>
                  <button className="mode-btn" onClick={() => fetchAvailable(m)} disabled={fetchingList[m.id]}>{fetchingList[m.id] ? '拉取中…' : '拉取模型列表'}</button>
                </div>
              </div>
            ))}
          </div>
          {!editing && <button className="mode-btn active" style={{ marginTop: 10 }} onClick={startNew}>＋ 新增模型</button>}

          {editing && (
            <div className="set-ai-edit">
              <div className="tip" style={{ marginBottom: 6 }}>{models.find((m) => m.id === editing.id) ? '编辑模型' : '新增模型'}</div>
              <label className="modal-field"><span>别名</span><input value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} placeholder="如：qwen本地" /></label>
              <label className="modal-field"><span>API 端点</span><input value={editing.endpoint} onChange={(e) => setEditing({ ...editing, endpoint: e.target.value })} placeholder="https://api.openai.com/v1" /></label>
              <label className="modal-field"><span>API Key</span><input type="password" value={editing.apiKey} onChange={(e) => setEditing({ ...editing, apiKey: e.target.value })} placeholder="sk-..." /></label>
              <label className="modal-field"><span>模型名</span>
                <input value={editing.model} onChange={(e) => setEditing({ ...editing, model: e.target.value })} placeholder="gpt-4o-mini / qwen2.5-7b-instruct" />
              </label>
              <label className="modal-field"><span>提示词格式</span>
                <select value={editing.format ?? 'chat'} onChange={(e) => setEditing({ ...editing, format: e.target.value as any })}>
                  <option value="chat">chat（标准 OpenAI 格式，cloud 模型）</option>
                  <option value="qwen">qwen（ChatML 模板，Qwen 系列本地模型）</option>
                  <option value="instruct">instruct（Llama2/3 INST 模板）</option>
                  <option value="raw">raw（纯文本拼接，自定义提示词工程）</option>
                </select>
              </label>
              <label className="modal-field"><span>自定义系统提示词（可选）</span>
                <input value={editing.systemPrompt ?? ''} onChange={(e) => setEditing({ ...editing, systemPrompt: e.target.value })} placeholder="留空用默认（专业写作/世界观助手）" />
              </label>

              <div className="set-ai-cap-section">
                <div className="set-ai-cap-title">模型能力</div>
                <div className="set-check-grid">
                  <label className="set-check-row">
                    <input type="checkbox" checked={!!editing.supportsVision} onChange={(e) => setEditing({ ...editing, supportsVision: e.target.checked })} />
                    <span>支持视觉输入</span>
                  </label>
                  <label className="set-check-row">
                    <input type="checkbox" checked={!!editing.supportsThinking} onChange={(e) => setEditing({ ...editing, supportsThinking: e.target.checked })} />
                    <span>输出含深度思考</span>
                  </label>
                  <label className="set-check-row">
                    <input type="checkbox" checked={!!editing.supportsTools} onChange={(e) => setEditing({ ...editing, supportsTools: e.target.checked })} />
                    <span>支持工具调用（已受过工具使用训练）</span>
                  </label>
                  <label className="set-check-row">
                    <input type="checkbox" checked={!!editing.supportsWebSearch} onChange={(e) => setEditing({ ...editing, supportsWebSearch: e.target.checked })} />
                    <span>支持联网搜索</span>
                  </label>
                </div>
                <div className="tip" style={{ marginTop: 4 }}>
                  勾选「支持工具调用」后，文章抽取 / 实体关联等功能会让模型按需检索世界观上下文（而非把候选库灌入 prompt），更适配宏大世界观。需模型原生支持 Function Calling（如 GPT-4o / DeepSeek / Qwen 等 chat 格式模型）；本地小模型若未训练该能力请勿勾选，否则会报错。
                </div>
                {editing.supportsWebSearch && (
                  <label className="modal-field"><span>联网搜索参数名</span>
                    <input value={editing.webSearchParam ?? ''} onChange={(e) => setEditing({ ...editing, webSearchParam: e.target.value })} placeholder="如 enable_search / web_search / search" />
                  </label>
                )}
              </div>

              <div className="set-ai-cap-section">
                <div className="set-ai-cap-title">计量与预算</div>
                <div className="set-check-grid">
                  <label className="set-check-row">
                    <input type="checkbox" checked={!!editing.requiresMetering} onChange={(e) => setEditing({ ...editing, requiresMetering: e.target.checked })} />
                    <span>启用用量统计</span>
                  </label>
                </div>
                <div className="set-meter-grid">
                  <label className="modal-field"><span>最大上下文窗口（tokens，0=未设置）</span>
                    <input type="number" min={0} step={1024} value={editing.contextWindow ?? 0} onChange={(e) => setEditing({ ...editing, contextWindow: Math.max(0, parseInt(e.target.value || '0', 10)) })} />
                  </label>
                  <label className="modal-field"><span>输入单价（元 / 1K tokens）</span>
                    <input type="number" min={0} step={0.001} value={editing.inputPricePer1K ?? 0} onChange={(e) => setEditing({ ...editing, inputPricePer1K: Math.max(0, parseFloat(e.target.value || '0')) })} />
                  </label>
                  <label className="modal-field"><span>输出单价（元 / 1K tokens）</span>
                    <input type="number" min={0} step={0.001} value={editing.outputPricePer1K ?? 0} onChange={(e) => setEditing({ ...editing, outputPricePer1K: Math.max(0, parseFloat(e.target.value || '0')) })} />
                  </label>
                  <label className="modal-field"><span>费用预算上限（元，0=不限）</span>
                    <input type="number" min={0} step={1} value={editing.budgetLimit ?? 0} onChange={(e) => setEditing({ ...editing, budgetLimit: Math.max(0, parseFloat(e.target.value || '0')) })} />
                  </label>
                  <label className="modal-field"><span>Token 预算上限（0=不限）</span>
                    <input type="number" min={0} step={1024} value={editing.tokenBudget ?? 0} onChange={(e) => setEditing({ ...editing, tokenBudget: Math.max(0, parseInt(e.target.value || '0', 10)) })} />
                  </label>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="mode-btn active" onClick={saveModel}>保存</button>
                <button className="mode-btn" onClick={() => setEditing(null)}>取消</button>
              </div>
            </div>
          )}
        </section>

        <section className="set-section">
          <h3>嵌入模型（语义检索）</h3>
          <p className="tip">
            配置一个 OpenAI 兼容的嵌入模型（如 text-embedding-3-small / bge-m3 / nomic-embed-text），用于「语义检索」——
            让文章抽取、实体关联、侧边栏约束在用户提及近义或改写名称时也能命中去重，弥补纯词法检索的不足。
            不配置时自动回退词法检索，不影响任何功能。嵌入模型可与聊天模型不同端点，务必单独填写。
          </p>
          <div className="set-ai-edit">
            <label className="modal-field"><span>嵌入端点</span>
              <input value={embedDraft?.endpoint ?? ''} onChange={(e) => setEmbedDraft((prev) => ({ ...(prev ?? { endpoint: '', apiKey: '', model: '' }), endpoint: e.target.value }))} placeholder="https://api.openai.com/v1" />
            </label>
            <label className="modal-field"><span>API Key</span>
              <input type="password" value={embedDraft?.apiKey ?? ''} onChange={(e) => setEmbedDraft((prev) => ({ ...(prev ?? { endpoint: '', apiKey: '', model: '' }), apiKey: e.target.value }))} placeholder="sk-...（本地模型可留空）" />
            </label>
            <label className="modal-field"><span>嵌入模型名</span>
              <input value={embedDraft?.model ?? ''} onChange={(e) => setEmbedDraft((prev) => ({ ...(prev ?? { endpoint: '', apiKey: '', model: '' }), model: e.target.value }))} placeholder="text-embedding-3-small / bge-m3" />
            </label>
            <label className="modal-field"><span>向量维度（可选，0=未知）</span>
              <input type="number" min={0} step={1} value={embedDraft?.dimensions ?? 0} onChange={(e) => setEmbedDraft((prev) => ({ ...(prev ?? { endpoint: '', apiKey: '', model: '' }), dimensions: Math.max(0, parseInt(e.target.value || '0', 10)) }))} placeholder="如 1536 / 1024" />
            </label>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="mode-btn active" onClick={saveEmbed}>保存嵌入模型</button>
              <button className="mode-btn" onClick={testEmbed}>测试连接</button>
              {useAIStore.getState().embeddingModel && (
                <button className="mode-btn danger" onClick={() => { useAIStore.getState().setEmbeddingModel(null); setEmbedDraft(null); setEmbedMsg('已清空嵌入模型'); }}>清空</button>
              )}
            </div>
            {embedMsg && <div className="tip" style={{ marginTop: 6, color: embedMsg.startsWith('✓') ? 'var(--accent)' : 'var(--danger)' }}>{embedMsg}</div>}
          </div>

          <div className="set-subblock">
            <h4>语义索引管理</h4>
            <p className="tip">
              索引缓存了每个实体的向量，<b>重启应用后无需重新生成</b>。可手动「立即索引/更新」（只增量重算变化的实体），
              或设置自动条件。未配置嵌入模型时本区不可用。
            </p>
            {(() => {
              const emb = useAIStore.getState().embeddingModel;
              if (!emb) return <p className="tip" style={{ color: 'var(--danger)' }}>请先在上方保存嵌入模型。</p>;
              const policy = emb.indexPolicy ?? DEFAULT_INDEX_POLICY;
              return (
                <div className="set-index-mgr">
                  <div className="set-index-stats">
                    {indexStats ? (
                      <span>
                        已索引实体：<b>{indexStats.count}</b> 个 ·
                        最近更新：<b>{indexStats.updatedAt ? new Date(indexStats.updatedAt).toLocaleString() : '—'}</b> ·
                        体积：<b>{(indexStats.sizeBytes / 1024).toFixed(1)} KB</b>
                      </span>
                    ) : (
                      <span>当前世界尚未建立索引</span>
                    )}
                  </div>
                  <div className="set-index-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                    <button className="mode-btn active" onClick={rebuildNow} disabled={indexBusy}>立即索引 / 更新</button>
                    <button className="mode-btn danger" onClick={clearIdx} disabled={indexBusy}>清除索引</button>
                    <div className="set-index-mode">
                      <span className="set-index-mode-label">自动索引：</span>
                      {(['manual', 'onEntityChange', 'onSave'] as IndexMode[]).map((m) => (
                        <button
                          key={m}
                          className={'mode-btn' + (policy.mode === m ? ' active' : '')}
                          onClick={() => setAutoMode(m)}
                        >
                          {m === 'manual' ? '仅手动' : m === 'onEntityChange' ? '实体变更自动' : '保存时自动'}
                        </button>
                      ))}
                    </div>
                  </div>
                  {indexProgress && <div className="tip" style={{ marginTop: 6 }}>{indexProgress}</div>}
                  {indexMsg && <div className="tip" style={{ marginTop: 6, color: indexMsg.startsWith('✓') ? 'var(--accent)' : 'var(--danger)' }}>{indexMsg}</div>}
                </div>
              );
            })()}
          </div>
        </section>

        <section className="set-section">
          <h3>AI 用量中心</h3>
          <AIUsagePanel />
        </section>

        <section className="set-section">
          <h3>导出 / 导入</h3>
          <p className="tip">导出当前世界观为 JSON（完整备份）或 Markdown（便于阅读/迁移）；也可从 JSON 文件恢复并创建新世界。</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="mode-btn" onClick={() => {
              const w = useWorldStore.getState().current;
              const data = useWorldStore.getState().worldsData[w];
              if (!data) return;
              const payload = JSON.stringify({ name: w, data }, null, 2);
              const fname = `世界观_${w}_${new Date().toISOString().slice(0, 10)}.json`;
              if (storage.isNative()) {
                storage.exportFile(fname, payload);
              } else {
                const blob = new Blob([payload], { type: 'application/json' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob); a.download = fname; a.click();
                URL.revokeObjectURL(a.href);
              }
            }}>导出为 JSON</button>
            <button className="mode-btn" onClick={() => {
              const w = useWorldStore.getState().current;
              const data = useWorldStore.getState().worldsData[w];
              if (!data) return;
              const md = worldToMarkdown(data as any, w);
              const fname = `世界观_${w}_${new Date().toISOString().slice(0, 10)}.md`;
              if (storage.isNative()) {
                storage.exportFile(fname, md);
              } else {
                const blob = new Blob([md], { type: 'text/markdown' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob); a.download = fname; a.click();
                URL.revokeObjectURL(a.href);
              }
            }}>导出为 Markdown</button>
            <button className="mode-btn" onClick={async () => {
              let wname: string | undefined;
              let text: string | undefined;
              if (storage.isNative()) {
                const picked = await storage.pickImport();
                if (!picked) return;
                wname = picked.name.replace(/\.json$/i, '');
                text = picked.content;
              } else {
                const input = document.createElement('input');
                input.type = 'file'; input.accept = '.json';
                await new Promise<void>((res) => { input.onchange = () => res(); input.click(); });
                const file = input.files?.[0]; if (!file) return;
                wname = file.name.replace(/\.json$/i, '');
                text = await file.text();
              }
              try {
                const parsed = JSON.parse(text!);
                const name = parsed.name || wname!;
                const data = parsed.data ?? parsed;
                if (!data || typeof data !== 'object') throw new Error('格式错误');
                const ws = useWorldviewStore.getState();
                if (ws.worlds.find((w) => w.name === name)) { alert(`"${name}" 已存在`); return; }
                useWorldStore.getState().addWorld(name);
                useWorldStore.setState((s) => ({ worldsData: { ...s.worldsData, [name]: data } }));
                ws.addWorld(name, '');
                await useWorldStore.getState().switchWorld(name);
                ws.setCurrent(name);
                const wd = useWorldStore.getState().worldsData[name];
                if (wd?.docs?.length) {
                  const d = wd.docs[0];
                  useUIStore.getState().openTab({ title: d.title, icon: d.icon, kind: 'doc', ref: d.id });
                }
                alert(`导入完成：${name}`);
              } catch { alert('文件格式有误，请选择有效的世界观 JSON 文件'); }
            }}>从 JSON 导入</button>
          </div>
        </section>

        <section className="set-section">
          <h3>存储位置</h3>
          <p className="tip">世界观文件保存在下方目录，删除该目录下所有 JSON 文件并重启应用即可清空数据；修改路径后会自动迁移历史数据。</p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
            <input
              value={saveDir}
              placeholder={saveDirLoading ? '正在读取实际存储路径…' : '点击「创建/校验」设置新路径'}
              onChange={(e) => setSaveDir(e.target.value)}
              style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', background: 'var(--bg)', color: 'var(--fg)', fontSize: 13 }}
            />
            <button className="mode-btn" onClick={openFolder}>打开文件夹</button>
            <button className="mode-btn" onClick={ensureDir}>创建/校验</button>
          </div>
          {saveMsg && <div className="tip" style={{ marginTop: 6, color: 'var(--accent)' }}>{saveMsg}</div>}
        </section>

        <section className="set-section">
          <h3>快捷键</h3>
          <p className="tip">点击右侧组合后按下想要的组合键即可自定义；按 Esc 取消。与已有组合冲突会提示。修改即时保存。</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <button className="mode-btn" onClick={() => { if (window.confirm('恢复全部默认快捷键？')) resetKeymap(); }}>恢复默认</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {ACTION_META.map((m) => (
              <div key={m.action} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-elev)' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{m.label}</div>
                  <div className="tip" style={{ marginTop: 2 }}>{m.desc}</div>
                </div>
                <button
                  className={'mode-btn' + (capturing === m.action ? ' active' : '')}
                  onClick={() => setCapturing(m.action)}
                  style={{ minWidth: 130, fontFamily: 'ui-monospace, Menlo, Consolas, monospace' }}
                  title="点击后按下组合键"
                >
                  {capturing === m.action ? '按下快捷键…' : formatCombo(keymap[m.action])}
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="set-section">
          <h3>关于</h3>
          <p className="tip">浮光 · AI 世界观编辑器 v2.0.0。</p>
          <p className="tip" style={{ marginTop: 4 }}>浮光掠影间，不过三千世界。</p>
          <p className="tip" style={{ marginTop: 2 }}>本应用由Agent智能体开发，其中所有代码均为AI生成。</p>
        </section>
      </div>
    </div>
  );
}
