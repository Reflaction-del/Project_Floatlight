import { useEffect, useState, useCallback } from 'react';

export function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  const refreshState = useCallback(async () => {
    try {
      const s = await (window as any).api?.winControl?.('query');
      if (s) setMaximized(s.maximized);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    refreshState();
    const unsub = (window as any).api?.onWinState?.((s: { maximized: boolean }) => {
      setMaximized(s.maximized);
    });
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, [refreshState]);

  const control = async (action: string) => {
    try {
      const s = await (window as any).api?.winControl?.(action);
      if (s) setMaximized(s.maximized);
    } catch { /* ignore */ }
  };

  const popupMenu = () => {
    try { (window as any).api?.winPopupMenu?.(); } catch { /* ignore */ }
  };

  return (
    <div className="title-bar" onDoubleClick={() => control('toggle-maximize')}>
      <div className="title-bar-drag" />
      <div className="title-bar-left">
        <button className="title-bar-menu" onClick={popupMenu} title="菜单">
          <span>☰</span>
        </button>
        <span className="title-bar-text">浮光 · AI 世界观编辑器</span>
      </div>
      <div className="title-bar-controls">
        <button className="title-bar-btn minimize" onClick={() => control('minimize')} title="最小化">
          <svg viewBox="0 0 10 10" width="10" height="10"><rect x="0" y="4.5" width="10" height="1" fill="currentColor" /></svg>
        </button>
        <button className="title-bar-btn maximize" onClick={() => control('toggle-maximize')} title={maximized ? '还原' : '最大化'}>
          {maximized ? (
            <svg viewBox="0 0 10 10" width="10" height="10"><path d="M2 4v4h6V4H2zm1-3v2h4V1H3z" fill="none" stroke="currentColor" strokeWidth="1" /></svg>
          ) : (
            <svg viewBox="0 0 10 10" width="10" height="10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" /></svg>
          )}
        </button>
        <button className="title-bar-btn close" onClick={() => control('close')} title="关闭">
          <svg viewBox="0 0 10 10" width="10" height="10"><path d="M1 1 L9 9 M9 1 L1 9" stroke="currentColor" strokeWidth="1.2" fill="none" /></svg>
        </button>
      </div>
    </div>
  );
}
