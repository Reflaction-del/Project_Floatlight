// ============================================================
// 视觉物料生成器 · 模板/风格市场（P3-D）
// ------------------------------------------------------------
// 纯本地市场：列表（内置模板 + 用户模板/风格）、导出 .fugu* 文件、
// 导入落库（worldStore）。零在线依赖——分发的单元就是文件本身。
// ============================================================

import { useRef, useState } from 'react';
import { useWorldStore } from '../../store/worldStore';
import { useMaterialStore } from './store';
import { MATERIAL_TEMPLATES } from './templates/registry';
import type { MaterialTemplate, MaterialStyle } from './types';
import { CATEGORY_LABELS } from './types';
import {
  buildTemplateFile, buildStyleFile, parseFuguFile, downloadTextFile,
  freshTemplateId, FUGU_TEMPLATE_EXT, FUGU_STYLE_EXT,
} from './market';

type Tab = 'template' | 'style';

export function MarketPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('template');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const userTemplates = useWorldStore((s) => s.worldsData[s.current]?.templates ?? []);
  const userStyles = useWorldStore((s) => s.worldsData[s.current]?.styles ?? []);
  const addTemplate = useWorldStore((s) => s.addTemplate);
  const deleteTemplate = useWorldStore((s) => s.deleteTemplate);
  const addStyle = useWorldStore((s) => s.addStyle);
  const deleteStyle = useWorldStore((s) => s.deleteStyle);
  const setActiveTemplate = useMaterialStore((s) => s.setActiveTemplate);
  const setActiveStyle = useMaterialStore((s) => s.setActiveStyle);
  const activeTemplateId = useMaterialStore((s) => s.activeTemplateId);
  const activeStyleId = useMaterialStore((s) => s.activeStyleId);

  const builtinTemplates = MATERIAL_TEMPLATES;

  const exportTemplate = (tpl: MaterialTemplate) => {
    downloadTextFile(`${tpl.name}${FUGU_TEMPLATE_EXT}`, buildTemplateFile(tpl));
    setMsg({ kind: 'ok', text: `已导出模板「${tpl.name}」` });
  };
  const exportStyle = (st: MaterialStyle) => {
    downloadTextFile(`${st.name}${FUGU_STYLE_EXT}`, buildStyleFile(st));
    setMsg({ kind: 'ok', text: `已导出风格「${st.name}」` });
  };

  const applyTemplate = (id: string) => {
    setActiveTemplate(id);
    setMsg({ kind: 'ok', text: '已设为当前模板' });
  };
  const applyStyle = (id: string) => {
    setActiveStyle(id);
    setMsg({ kind: 'ok', text: '已设为当前风格' });
  };

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 允许重复选同一文件
    if (!file) return;
    try {
      const text = await file.text();
      const res = parseFuguFile(text);
      if (!res.ok) { setMsg({ kind: 'err', text: res.error }); return; }
      if (res.kind === 'template') {
        const tpl: MaterialTemplate = { ...res.payload, id: freshTemplateId() };
        addTemplate(tpl);
        setTab('template');
        setMsg({ kind: 'ok', text: `已导入模板「${tpl.name}」` });
      } else {
        const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = res.payload;
        addStyle({ ...rest, builtin: false });
        setTab('style');
        setMsg({ kind: 'ok', text: `已导入风格「${res.payload.name}」` });
      }
    } catch {
      setMsg({ kind: 'err', text: '读取文件失败' });
    }
  };

  return (
    <div className="mf-market-backdrop" onClick={onClose}>
      <div className="mf-market-modal" onClick={(e) => e.stopPropagation()}>
        <div className="mf-market-head">
          <div className="mf-market-title">模板 / 风格市场</div>
          <div className="mf-market-sub">本地市场 · 零在线依赖 · 用 .fugu* 文件分享</div>
          <button className="mf-market-close" onClick={onClose}>✕</button>
        </div>

        <div className="mf-market-tabs">
          <button className={tab === 'template' ? 'mk-tab on' : 'mk-tab'} onClick={() => setTab('template')}>
            模板（{builtinTemplates.length + userTemplates.length}）
          </button>
          <button className={tab === 'style' ? 'mk-tab on' : 'mk-tab'} onClick={() => setTab('style')}>
            风格（{userStyles.length}）
          </button>
          <button className="mk-import" onClick={() => fileRef.current?.click()}>＋ 导入 .fugu* 文件</button>
          <input ref={fileRef} type="file" accept={`${FUGU_TEMPLATE_EXT},${FUGU_STYLE_EXT},application/json,.json`} hidden onChange={onPickFile} />
        </div>

        {msg && (
          <div className={msg.kind === 'ok' ? 'mf-market-msg ok' : 'mf-market-msg err'}>{msg.text}</div>
        )}

        <div className="mf-market-body">
          {tab === 'template' ? (
            <div className="mk-cols">
              <div className="mk-col">
                <div className="mk-col-title">内置模板</div>
                {builtinTemplates.map((t) => (
                  <div key={t.id} className={activeTemplateId === t.id ? 'mk-item on' : 'mk-item'}>
                    <div className="mk-item-main">
                      <div className="mk-item-name">{t.name}</div>
                      <div className="mk-item-meta">{(t.description ?? '').slice(0, 40) || '—'}</div>
                    </div>
                    <div className="mk-item-acts">
                      <button className="mk-act" onClick={() => applyTemplate(t.id)}>应用</button>
                      <button className="mk-act" onClick={() => exportTemplate(t)}>导出</button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mk-col">
                <div className="mk-col-title">我的模板（可导出 / 删除）</div>
                {userTemplates.length === 0 && <div className="mk-empty">还没有自定义模板，去「模板编辑器」新建</div>}
                {userTemplates.map((t) => (
                  <div key={t.id} className={activeTemplateId === t.id ? 'mk-item on' : 'mk-item'}>
                    <div className="mk-item-main">
                      <div className="mk-item-name">{t.name}</div>
                      <div className="mk-item-meta">{CATEGORY_LABELS[t.category]}</div>
                    </div>
                    <div className="mk-item-acts">
                      <button className="mk-act" onClick={() => applyTemplate(t.id)}>应用</button>
                      <button className="mk-act" onClick={() => exportTemplate(t)}>导出</button>
                      <button className="mk-act danger" onClick={() => { deleteTemplate(t.id); setMsg({ kind: 'ok', text: `已删除模板「${t.name}」` }); }}>删除</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="mk-col" style={{ width: '100%' }}>
              <div className="mk-col-title">风格预设（可导出 / 删除）</div>
              {userStyles.length === 0 && <div className="mk-empty">还没有风格，去「风格编辑器」新建</div>}
              {userStyles.map((st) => (
                <div key={st.id} className={activeStyleId === st.id ? 'mk-item on' : 'mk-item'}>
                  <div className="mk-item-main">
                    <div className="mk-item-name">
                      <span className="mk-swatch" style={{ background: st.token.palette.accent }} />
                      {st.name}
                    </div>
                    <div className="mk-item-meta">{(st.tags ?? []).join(' / ') || '—'}</div>
                  </div>
                  <div className="mk-item-acts">
                    <button className="mk-act" onClick={() => applyStyle(st.id)}>应用</button>
                    <button className="mk-act" onClick={() => exportStyle(st)}>导出</button>
                    {!st.builtin && (
                      <button className="mk-act danger" onClick={() => { deleteStyle(st.id); setMsg({ kind: 'ok', text: `已删除风格「${st.name}」` }); }}>删除</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
