import { useState, useEffect } from 'react';
import { useRecentFilesStore } from '../store/recentFilesStore';
import { useWorldviewStore } from '../store/worldviewStore';
import { useWorldStore } from '../store/worldStore';
import { useUIStore } from '../store/uiStore';
import { storage } from '../storage';
import {
  IconFolder,
  IconDoc,
  IconSave,
  IconSearch,
  Svg,
} from './icons';

/** 格式化相对时间 */
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  return new Date(iso).toLocaleDateString('zh-CN');
}

export function StartPage() {
  const recents = useRecentFilesStore((s) => s.recents);
  const removeRecent = useRecentFilesStore((s) => s.removeRecent);
  const worlds = useWorldviewStore((s) => s.worlds);
  const current = useWorldviewStore((s) => s.current);
  const switchWorld = useWorldStore((s) => s.switchWorld);
  const setCurrentWorld = useWorldviewStore((s) => s.setCurrent);
  const addRecent = useRecentFilesStore((s) => s.addRecent);
  const openTab = useUIStore((s) => s.openTab);

  // 启动时自动记录当前世界到近期列表
  useEffect(() => {
    if (current) {
      const w = worlds.find((x) => x.name === current);
      if (w) addRecent(current, w.icon);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 点击近期文件 → 切换世界并打开第一个文档 */
  const handleOpenRecent = async (name: string) => {
    // 如果已经是当前世界，直接打开第一个文档
    if (name === current) {
      openFirstDoc(name);
      return;
    }
    // 切换世界
    try {
      const ok = await switchWorld(name);
      if (!ok) { alert('无法切换到该文件'); return; }
      setCurrentWorld(name);
      const w = worlds.find((x) => x.name === name);
      if (w) addRecent(name, w.icon);
      openFirstDoc(name);
    } catch {
      alert('无法打开该文件');
    }
  };

  /** 打开指定世界的第一个文档；无文档则 fallback 到实体库 */
  const openFirstDoc = (worldName: string) => {
    const wd = useWorldStore.getState().worldsData[worldName];
    if (wd?.docs?.length) {
      const first = wd.docs[0];
      openTab({ title: first.title, icon: first.icon ?? '', kind: 'doc', ref: first.id });
    } else {
      // 无文档时打开实体库作为入口
      openTab({ title: '实体库', icon: 'entities', kind: 'module', ref: 'entities' });
    }
  };

  /** 新建世界观 */
  const handleNew = () => {
    openTab({ title: '实体库', icon: 'entities', kind: 'module', ref: 'entities' });
  };

  /** 打开文件 */
  const handleOpen = async () => {
    if (!storage.isNative()) return;
    try {
      const picked = await storage.pickImport();
      if (!picked) return;
      // TODO: 完整的导入逻辑（复用 SettingsView 的导入流程）
      alert(`已选择：${picked.name}\n导入功能请在「设置 → 导入」中完成`);
    } catch {
      /* cancelled */
    }
  };

  return (
    <div className="start-page">
      {/* 品牌区 */}
      <div className="start-brand">
        <div className="start-logo">
          <Svg size={36}>
            <path d="M4 4h16v16H4V4zm2 2v12h12V6H6z" fill="currentColor" opacity={0.3} />
            <path d="M8 8h8v2H8V8zm0 4h8v2H8v-2zm0 4h5v2H8v-2z" fill="currentColor" />
          </Svg>
        </div>
        <h1 className="start-title">浮光 · 世界观编辑器</h1>
        <p className="start-subtitle">构建你的幻想世界</p>
      </div>

      {/* 快捷操作 */}
      <div className="start-actions">
        <button className="start-btn primary" onClick={handleNew}>
          <Svg size={20}><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="currentColor" /></Svg>
          新建世界观
        </button>
        <button className="start-btn secondary" onClick={handleOpen}>
          <IconFolder size={20} />
          打开文件
        </button>
      </div>

      {/* 近期文件 */}
      <div className="start-recents-section">
        <div className="start-recents-header">
          <h2 className="start-recents-title">近期编辑</h2>
          {recents.length > 0 && (
            <button className="start-clear-btn" onClick={() => useRecentFilesStore.getState().clearRecents()}>
              清除列表
            </button>
          )}
        </div>

        {recents.length === 0 ? (
          <div className="start-empty">
            <Svg size={40} style={{ opacity: 0.25 }}>
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" fill="none" stroke="currentColor" strokeWidth={1.5} />
              <path d="M17 21V11H7v10" fill="none" stroke="currentColor" strokeWidth={1.5} />
              <path d="M7 3v5h5" fill="none" stroke="currentColor" strokeWidth={1.5} />
            </Svg>
            <p>暂无近期文件</p>
            <span>创建或打开一个世界观后，这里会显示快速入口</span>
          </div>
        ) : (
          <ul className="start-recents-list">
            {recents.map((r) => (
              <li key={r.name} className="start-recent-card" onClick={() => handleOpenRecent(r.name)}>
                <span className="start-recent-icon">{r.icon}</span>
                <div className="start-recent-info">
                  <div className="start-recent-name">{r.name}</div>
                  <div className="start-recent-time">{timeAgo(r.lastOpened)}</div>
                </div>
                <button
                  className="start-recent-remove"
                  title="移除"
                  onClick={(e) => { e.stopPropagation(); removeRecent(r.name); }}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 底部提示 */}
      <div className="start-footer">
        <span><IconSave size={12} /> 所有改动实时自动保存</span>
        <span><IconSearch size={12} /> 按 Ctrl+K 快速搜索</span>
      </div>
    </div>
  );
}
