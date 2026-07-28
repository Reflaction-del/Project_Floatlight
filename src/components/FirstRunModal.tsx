import { useEffect, useRef, useState } from 'react';
import { useUIStore } from '../store/uiStore';
import { useWorldStore } from '../store/worldStore';
import { useWorldviewStore, displayWorldName, EXAMPLE_WORLD } from '../store/worldviewStore';

const TEMPLATES = [
  { key: 'empty', label: '空白', desc: '零文件、零时间轴，从一张白纸开始' },
  { key: 'novel', label: '小说', desc: '角色 / 场景 / 章节三文件夹 + 3 示例文档' },
  { key: 'script', label: '剧本', desc: '角色 / 场次两文件夹 + 2 示例文档' },
] as const;

/**
 * 首次安装启动后的引导弹窗：引导用户新建属于自己的世界观项目。
 * 同时提供「先看看示例」入口，示例工程为随包内置的《幻光纪元（示例）》。
 */
export function FirstRunModal() {
  const firstRun = useWorldviewStore((s) => s.firstRun);
  const setFirstRun = useWorldviewStore((s) => s.setFirstRun);
  const addWorldInfo = useWorldviewStore((s) => s.addWorld);
  const setCurrent = useWorldviewStore((s) => s.setCurrent);
  const worlds = useWorldviewStore((s) => s.worlds);
  const addWorldData = useWorldStore((s) => s.addWorld);
  const switchWorld = useWorldStore((s) => s.switchWorld);

  const [name, setName] = useState('');
  const [template, setTemplate] = useState<'empty' | 'novel' | 'script'>('empty');
  const inputRef = useRef<HTMLInputElement>(null);

  // Electron 窗口未聚焦时 autoFocus 不稳定，用 ref + 延时强制聚焦
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, []);

  if (!firstRun) return null;

  const dismiss = () => setFirstRun(false);

  const doCreate = async () => {
    const n = name.trim();
    if (!n) { alert('请先给你的世界观起个名字'); return; }
    if (worlds.find((w) => w.name === n)) { alert('已存在同名世界，换一个名字吧'); return; }
    // 先关闭旧标签页，避免切换后用旧 ref 在新世界找不到数据而白屏
    const ids = useUIStore.getState().tabs.map((t) => t.id);
    ids.forEach((id) => useUIStore.getState().closeTab(id));
    useUIStore.getState().setSplitTab(null);
    // 1) 写入世界数据（按模板）
    addWorldData(n, template);
    // 2) 写入世界观列表
    addWorldInfo(n);
    // 3) 切换到新世界（不弹确认框）
    await switchWorld(n);
    setCurrent(n);
    // 4) 结束引导
    dismiss();
  };

  return (
    <div className="modal-mask" onMouseDown={dismiss}>
      <div className="modal fr-modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="fr-title">欢迎使用 浮光 · AI 世界观编辑器</h2>
        <p className="fr-sub">
          开始创作前，建议先新建一个<strong>属于你自己的世界观项目</strong>。
          我们已经为你准备了一份示例工程《{displayWorldName(worlds.find((w) => w.name === EXAMPLE_WORLD))}》，
          可以随时在左上角「世界观管理」里打开参考。
        </p>

        <div className="fr-form">
          <label className="fr-label">
            <span>世界观名称</span>
            <input
              ref={inputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：星海编年、九州风物志…"
              onKeyDown={(e) => e.key === 'Enter' && doCreate()}
            />
          </label>

          <div className="fr-label">
            <span>选择模板</span>
            <div className="fr-tpls">
              {TEMPLATES.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className={'fr-tpl' + (template === t.key ? ' active' : '')}
                  onClick={() => setTemplate(t.key)}
                >
                  <div className="fr-tpl-label">{t.label}</div>
                  <div className="fr-tpl-desc">{t.desc}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="modal-actions fr-actions">
          <button className="mode-btn" onClick={dismiss}>先看看示例</button>
          <button className="mode-btn active" onClick={doCreate}>＋ 创建并进入</button>
        </div>
      </div>
    </div>
  );
}
