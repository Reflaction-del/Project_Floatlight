import { useState, useEffect, useRef } from 'react';
import { usePromptStore } from '../store/promptStore';

const PALETTE = [
  '#000000', '#444444', '#888888', '#cccccc', '#ffffff',
  '#ef4444', '#f59e0b', '#eab308', '#22c55e', '#10b981',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#f43f5e',
  '#1e293b', '#0f172a', '#92400e', '#7c2d12', '#166534',
];
const RECENT_KEY = 'fl-recent-colors';

function loadRecent(): string[] {
  try { const r = localStorage.getItem(RECENT_KEY); return r ? JSON.parse(r) : []; } catch { return []; }
}
function saveRecent(list: string[]) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 8))); } catch { /* ignore */ }
}

export function PromptModal() {
  const config = usePromptStore((s) => s.config);
  const close = usePromptStore((s) => s.close);
  const [values, setValues] = useState<Record<string, string>>({});
  const [recent, setRecent] = useState<string[]>(loadRecent());
  const initialSet = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => { initialSet.current = false; }, [config]);

  // 弹窗出现时，确保第一个可输入字段获得焦点（Electron 中 autoFocus 不稳定）
  useEffect(() => {
    if (!config) return;
    const t = window.setTimeout(() => {
      inputRef.current?.focus();
      selectRef.current?.focus();
    }, 30);
    return () => window.clearTimeout(t);
  }, [config]);

  if (!config) return null;

  // 初始化 values（每个字段取其当前值或 default）
  if (!initialSet.current) {
    for (const f of config.fields) {
      if (values[f.name] === undefined) values[f.name] = f.default ?? (f.type === 'color' ? '#000000' : '');
    }
    initialSet.current = true;
  }

  const onOk = () => {
    const out: Record<string, string> = {};
    for (const f of config.fields) {
      const v = (values[f.name] ?? f.default ?? '').trim();
      out[f.name] = v;
      if (f.type === 'color' && /^#[0-9a-f]{6}$/i.test(v)) {
        const next = [v, ...recent.filter((c) => c.toLowerCase() !== v.toLowerCase())].slice(0, 8);
        setRecent(next); saveRecent(next);
      }
    }
    close(out);
  };
  const onCancel = () => close(null);

  const focusIndex = config.fields.findIndex((f) => f.type !== 'select');
  const setVal = (name: string, v: string) => setValues((s) => ({ ...s, [name]: v }));

  return (
    <div className="modal-mask" onMouseDown={onCancel}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()} style={{ width: 380 }}>
        <h3>{config.title}</h3>
        {config.fields.map((f, i) => {
          const isFirstInput = i === focusIndex;
          return (
            <div key={f.name} className="modal-field">
              <span>{f.label}</span>
              {f.type === 'select' ? (
                <select ref={isFirstInput ? selectRef : undefined} autoFocus={isFirstInput} value={values[f.name] ?? f.default ?? ''} onChange={(e) => setVal(f.name, e.target.value)}>
                  {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : f.type === 'color' ? (
                <div className="cp-wrap">
                  <div className="cp-palette">
                    {PALETTE.map((c) => (
                      <button key={c} type="button" className={'cp-swatch' + ((values[f.name] ?? '').toLowerCase() === c ? ' active' : '')} style={{ background: c }} onClick={() => setVal(f.name, c)} title={c} />
                    ))}
                  </div>
                  {recent.length > 0 && (
                    <>
                      <div className="cp-recent-label">最近使用</div>
                      <div className="cp-palette">
                        {recent.map((c) => (
                          <button key={c} type="button" className={'cp-swatch' + ((values[f.name] ?? '').toLowerCase() === c.toLowerCase() ? ' active' : '')} style={{ background: c }} onClick={() => setVal(f.name, c)} title={c} />
                        ))}
                      </div>
                    </>
                  )}
                  <div className="cp-input-row">
                    <input type="color" value={values[f.name] ?? '#000000'} onChange={(e) => setVal(f.name, e.target.value)} />
                    <input
                      ref={isFirstInput ? inputRef : undefined}
                      autoFocus={isFirstInput}
                      type="text"
                      value={values[f.name] ?? ''}
                      onChange={(e) => setVal(f.name, e.target.value)}
                      placeholder="#ffffff"
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onOk(); } if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } }}
                    />
                  </div>
                </div>
              ) : (
                <input
                  ref={isFirstInput ? inputRef : undefined}
                  autoFocus={isFirstInput}
                  type={f.type === 'number' ? 'number' : 'text'}
                  placeholder={f.placeholder}
                  value={values[f.name] ?? ''}
                  onChange={(e) => setVal(f.name, e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onOk(); } if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } }}
                />
              )}
            </div>
          );
        })}
        <div className="modal-actions">
          <button className="mode-btn" onClick={onCancel}>取消</button>
          <button className="mode-btn active" onClick={onOk}>确定</button>
        </div>
      </div>
    </div>
  );
}
