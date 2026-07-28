import { useState, useEffect, useMemo, useRef } from 'react';
import { useWorldStore } from '../../store/worldStore';
import { useUIStore } from '../../store/uiStore';
import { ENTITY_TEMPLATES, EntityType } from '../../types';

const DISMISS_KEY = 'fl-onboarding-dismissed';

/**
 * M5 新手引导：首屏帮助用户创建「第一个角色」。
 * 触发条件：当前世界没有任何实体，且用户此前未选择「不再提示」。
 */
export function OnboardingModal() {
  const worldLoaded = useWorldStore((s) => !!s.worldsData[s.current]);
  const entities = useWorldStore((s) => s.worldsData[s.current]?.entities ?? []);
  const addEntity = useWorldStore((s) => s.addEntity);
  const openTab = useUIStore((s) => s.openTab);

  const [dismissed, setDismissed] = useState(true);
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [err, setErr] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === '1');
    } catch {
      setDismissed(false);
    }
  }, []);

  // 关键修复（史诗级“文本框不可编辑”bug）：
  // 1) 必须等世界数据真正载入（worldsData[current] 存在）后才允许显示，
  //    避免启动瞬间 current 为 undefined 导致 entities 瞬时空数组、引导层闪现抢焦点。
  // 2) show 仅在“世界已载入 + 确实无实体 + 用户未 dismiss”时为真。
  const show = worldLoaded && entities.length === 0 && !dismissed;

  // autoFocus 在模态异步出现时常失效（窗口未聚焦时 focus() 被忽略），这里用 ref 延迟强制聚焦，
  // 保证输入框一定可获得焦点——这也是「切换应用再切回即可输入」现象的根因修复
  useEffect(() => {
    if (!show) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, [show]);

  const characterFields = useMemo(
    () => ENTITY_TEMPLATES.find((t) => t.type === ('character' as EntityType))?.fields ?? [],
    [],
  );

  const create = () => {
    const n = name.trim();
    if (!n) {
      setErr('请先给角色起个名字');
      return;
    }
    const id = addEntity({
      type: 'character',
      name: n,
      fields: characterFields.map((f) => ({ label: f.label, value: '' })),
      custom: [],
      tags: [],
      note: bio.trim() || undefined,
    });
    openTab({ title: n, icon: 'character', kind: 'entity', ref: id });
    // entities.length 变为 1，组件自动隐藏
  };

  const skip = () => {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
    setDismissed(true);
  };

  if (!show) return null;

  return (
    <div className="onb-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) skip(); }}>
      <div className="onb-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="onb-emoji">角色</div>
        <h2 className="onb-title">欢迎来到「浮光」</h2>
        <p className="onb-sub">一个本地优先的世界观编辑器。先创建你的<strong>第一个角色</strong>，就能开始搭建整个世界观。</p>

        <label className="onb-label">角色名 *</label>
        <input
          ref={inputRef}
          className="onb-input"
          value={name}
          placeholder="例如：林夜、艾莎、无名剑客…"
          onChange={(e) => { setName(e.target.value); setErr(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
        />
        {err && <div className="onb-err">{err}</div>}

        <label className="onb-label">一句话简介（可选）</label>
        <textarea
          className="onb-input onb-textarea"
          value={bio}
          rows={3}
          placeholder="他是谁？想要什么？一句就够，之后随时补充。"
          onChange={(e) => setBio(e.target.value)}
        />

        <div className="onb-actions">
          <button className="onb-skip" onClick={skip}>先逛逛</button>
          <button className="onb-primary" onClick={create}>创建并进入 →</button>
        </div>

        <p className="onb-tip">提示：之后可在 实体库 添加势力 / 地点 / 事件 / 时间线节点 / 规则，并在 关系图谱 中连接它们。</p>
      </div>
    </div>
  );
}
