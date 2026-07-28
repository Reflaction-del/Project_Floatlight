// ============================================================
// 视觉物料生成器 · 视觉一致性面板（P1-C）
// ------------------------------------------------------------
// 展示风格令牌漂移 + 实体就绪度 + 跨图唯一性碰撞 + 资产引用计数。
// 接入 src/utils/consistency.ts 的同一套「问题」心智模型（severity 分组）。
// ============================================================

import { useMemo, useState } from 'react';
import type { MaterialStyle, PortraitMode } from '../types';
import type { WikiEntity } from '../../../types';
import {
  scanMaterialConsistency,
  type IssueSeverity,
  type MaterialIssue,
} from './visualConsistency';

interface Props {
  entities: WikiEntity[];
  styles: MaterialStyle[];
  worldName: string;
  initialTemplateId: string | null;
  initialPortraitMode: PortraitMode;
  onClose: () => void;
}

const SEV_ORDER: IssueSeverity[] = ['error', 'warn', 'info'];
const SEV_LABEL: Record<IssueSeverity, string> = { error: '错误', warn: '警告', info: '提示' };

export function ConsistencyPanel({
  entities,
  styles,
  worldName,
  initialTemplateId,
  initialPortraitMode,
  onClose,
}: Props) {
  const [templateId, setTemplateId] = useState<string>(initialTemplateId ?? 'staffFile');
  const [portraitMode, setPortraitMode] = useState<PortraitMode>(initialPortraitMode);

  const { issues, assetReport } = useMemo(
    () =>
      scanMaterialConsistency({
        entities,
        styles,
        template: templateId,
        portraitMode,
        worldName,
      }),
    [entities, styles, templateId, portraitMode, worldName],
  );

  const counts = useMemo(() => {
    const c: Record<IssueSeverity, number> = { error: 0, warn: 0, info: 0 };
    for (const i of issues) c[i.severity]++;
    return c;
  }, [issues]);

  const portraitCoverage = assetReport.portraits.filter((p) => p.hasSource).length;

  return (
    <div className="mf-modal-backdrop" onClick={onClose}>
      <div className="mf-modal mf-consistency-modal" onClick={(e) => e.stopPropagation()}>
        <div className="mf-modal-head">
          <div className="mf-modal-title">视觉一致性校验</div>
          <button className="mf-modal-x" onClick={onClose} title="关闭">×</button>
        </div>

        <div className="mf-consistency-opts">
          <div className="mf-field" style={{ flex: 1 }}>
            <label>校验模板</label>
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="staffFile">员工 / 角色档案</option>
              <option value="idCard">证件 / ID 卡</option>
              <option value="menu">日常 / 菜单</option>
            </select>
          </div>
          <div className="mf-field">
            <label>头像模式</label>
            <div className="mf-seg">
              {(['entity', 'upload', 'ai'] as PortraitMode[]).map((m) => (
                <button
                  key={m}
                  className={'mf-seg-btn' + (portraitMode === m ? ' active' : '')}
                  onClick={() => setPortraitMode(m)}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mf-consistency-summary">
          <span className="mf-pill mf-pill-err">错误 {counts.error}</span>
          <span className="mf-pill mf-pill-warn">警告 {counts.warn}</span>
          <span className="mf-pill mf-pill-info">提示 {counts.info}</span>
          <span className="mf-pill">头像覆盖 {portraitCoverage}/{assetReport.portraits.length}</span>
        </div>

        <div className="mf-consistency-body">
          {/* 问题列表 */}
          <div className="mf-consistency-col">
            <div className="mf-consistency-col-title">问题与漂移</div>
            {issues.length === 0 ? (
              <div className="mf-consistency-ok">未发现一致性问题 ✓</div>
            ) : (
              SEV_ORDER.map((sev) => {
                const list: MaterialIssue[] = issues.filter((i) => i.severity === sev);
                if (list.length === 0) return null;
                return (
                  <div key={sev} className="mf-issue-group">
                    <div className={`mf-issue-group-head sev-${sev}`}>{SEV_LABEL[sev]}（{list.length}）</div>
                    {list.map((it) => (
                      <div key={it.id} className="mf-issue-row">
                        <div className="mf-issue-msg">{it.message}</div>
                        {it.targetName && <div className="mf-issue-target">→ {it.targetName}</div>}
                        {it.hint && <div className="mf-issue-hint">{it.hint}</div>}
                      </div>
                    ))}
                  </div>
                );
              })
            )}
          </div>

          {/* 资产引用计数 */}
          <div className="mf-consistency-col">
            <div className="mf-consistency-col-title">资产引用计数</div>
            <div className="mf-asset-title">Logo（被 {assetReport.logos[0]?.referencedBy ?? 0} 张物料引用）</div>
            <table className="mf-asset-table">
              <thead>
                <tr><th>风格</th><th>Logo</th><th>引用</th></tr>
              </thead>
              <tbody>
                {assetReport.logos.map((l) => (
                  <tr key={l.styleId}>
                    <td>{l.name}</td>
                    <td>{l.hasLogo ? '✓ 已设' : '✗ 缺'}</td>
                    <td>{l.referencedBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mf-asset-title">头像覆盖</div>
            <div className="mf-asset-coverage">
              {assetReport.portraits.map((p) => (
                <span
                  key={p.entityId}
                  className={'mf-dot' + (p.hasSource ? ' on' : ' off')}
                  title={`${p.name}（${p.mode}）`}
                />
              ))}
            </div>
            <div className="mf-asset-legend">● 有来源　○ 缺头像</div>
          </div>
        </div>
      </div>
    </div>
  );
}
