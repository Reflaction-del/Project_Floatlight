import { useState, useMemo } from 'react';
import { useWorldStore } from '../../store/worldStore';
import { useUIStore } from '../../store/uiStore';
import { scanConflicts, summarize, RULES } from '../../utils/consistency';

export function ConsistencyView() {
  const entities = useWorldStore((s) => s.worldsData[s.current]?.entities ?? []);
  const relations = useWorldStore((s) => s.worldsData[s.current]?.relations ?? []);
  const clearRelations = useWorldStore((s) => s.clearRelations);
  const openTab = useUIStore((s) => s.openTab);

  // 默认开启全部弱规则；用户可单独关闭
  const [disabledWeak, setDisabledWeak] = useState<string[]>([]);

  const conflicts = useMemo(
    () => scanConflicts(entities, relations, { disabledWeak }),
    [entities, relations, disabledWeak],
  );
  const summary = useMemo(() => summarize(conflicts), [conflicts]);

  const toggleWeak = (id: string) =>
    setDisabledWeak((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const onJump = (id: string) => {
    const e = entities.find((x) => x.id === id);
    if (e) openTab({ title: e.name, icon: e.type, kind: 'entity', ref: e.id });
  };

  return (
    <div className="editor-scroll">
      <div className="editor-wrap consistency-view">
        <div className="cv-head">
          <h2>一致性检查</h2>
          <div className="cv-head-tools">
            <span className={'cv-badge strong' + (summary.strong ? ' on' : '')}>强冲突 {summary.strong}</span>
            <span className={'cv-badge weak' + (summary.weak ? ' on' : '')}>弱提示 {summary.weak}</span>
          </div>
        </div>
        <p className="tip">
          M3 一致性引擎：在实体与关系之间自动校验设定冲突。强冲突为设定硬伤必须修；弱提示默认开启，可在设定需要时关闭。
        </p>

        <div className="cv-rules">
          <div className="cv-rules-title">规则开关</div>
          <div className="cv-rule-list">
            {RULES.map((r) => {
              const isWeak = r.severity === 'weak';
              const off = isWeak && disabledWeak.includes(r.id);
              return (
                <label key={r.id} className={'cv-rule' + (isWeak ? '' : ' always') + (off ? ' off' : '')} title={r.description}>
                  <input
                    type="checkbox"
                    checked={!off}
                    disabled={!isWeak}
                    onChange={() => isWeak && toggleWeak(r.id)}
                  />
                  <span className={'cv-rule-sev ' + r.severity}>{isWeak ? '弱' : '强'}</span>
                  <span className="cv-rule-name">{r.name}</span>
                  <span className="cv-rule-desc">{r.description}</span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="cv-divider" />

        {conflicts.length === 0 ? (
          <div className="placeholder-view" style={{ minHeight: 220 }}>
            <div className="big">完成</div>
            <div>未发现一致性问题，世界观设定自洽。</div>
          </div>
        ) : (
          <div className="cv-list">
            {conflicts.map((c) => (
              <div key={c.id} className={'cv-item ' + c.severity}>
                <div className="cv-item-head">
                  <span className={'cv-item-sev ' + c.severity}>{c.severity === 'strong' ? '强' : '弱'}</span>
                  <span className="cv-item-rule">{c.ruleName}</span>
                  <span className="cv-item-msg">{c.message}</span>
                </div>
                {c.entityIds.length > 0 && (
                  <div className="cv-item-actions">
                    {c.entityIds.map((id, i) => {
                      const e = entities.find((x) => x.id === id);
                      if (!e) return null;
                      return (
                        <button key={id} className="cv-jump" onClick={() => onJump(id)}>
                          {e.name}
                          {i < c.entityIds.length - 1 ? '' : ''}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {relations.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <button
              className="mode-btn danger"
              onClick={() => { if (window.confirm('确定清空全部关系连线？此操作不可撤销。')) clearRelations(); }}
            >清空全部关系</button>
          </div>
        )}
      </div>
    </div>
  );
}
