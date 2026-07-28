import { useState } from 'react';
import { NodeViewWrapper, NodeViewContent, type NodeViewProps } from '@tiptap/react';
import { CALLOUT_TYPES, type CalloutType } from './callout';

const META: Record<CalloutType, { label: string }> = {
  note: { label: '笔记' },
  warning: { label: '警告' },
  info: { label: '信息' },
  success: { label: '成功' },
  danger: { label: '危险' },
  question: { label: '疑问' },
};

export function CalloutView({ node, updateAttributes, editor }: NodeViewProps) {
  const type = ((node.attrs.type as CalloutType) || 'note') as CalloutType;
  const meta = META[type] || META.note;
  const collapsed = !!node.attrs.collapsed;
  const [picking, setPicking] = useState(false);

  return (
    <NodeViewWrapper className={`callout callout-${type}${collapsed ? ' collapsed' : ''}`} data-callout-type={type}>
      <div className="callout-bar" contentEditable={false}>
        <button
          type="button"
          className="callout-toggle"
          title={collapsed ? '展开' : '折叠'}
          onClick={() => updateAttributes({ collapsed: !collapsed })}
        >
          {collapsed ? '▸' : '▾'}
        </button>
        <span className="callout-icon" title={meta.label}>
          {meta.label}
        </span>
        <input
          className="callout-title"
          value={(node.attrs.title as string) || ''}
          placeholder={meta.label}
          onChange={(e) => updateAttributes({ title: e.target.value })}
        />
        {editor.isEditable && (
          <button type="button" className="callout-type-btn" title="切换类型" onClick={() => setPicking((v) => !v)}>
            ✦
          </button>
        )}
        {picking && (
          <div className="callout-picker" onMouseLeave={() => setPicking(false)}>
            {CALLOUT_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                className={'callout-pick' + (t === type ? ' active' : '')}
                onClick={() => {
                  updateAttributes({ type: t });
                  setPicking(false);
                }}
              >
                {META[t].label}
              </button>
            ))}
          </div>
        )}
      </div>
      <NodeViewContent
        className="callout-body"
        style={{ display: collapsed ? 'none' : undefined }}
      />
    </NodeViewWrapper>
  );
}
