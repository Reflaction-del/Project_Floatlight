import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';

export function ImageNodeView({ node, updateAttributes, selected, editor, getPos }: NodeViewProps) {
  const rotation = (node.attrs.rotation as number) ?? 0;
  const width = (node.attrs.width as number) ?? 360;
  const height = (node.attrs.height as number) ?? 0;
  const align = (node.attrs.align as string) ?? 'center';

  const rotate = (d: number) =>
    updateAttributes({ rotation: Math.max(-360, Math.min(360, rotation + d)) });
  const scale = (d: number) => {
    const w = Math.max(50, Math.min(800, width + d));
    updateAttributes({ width: w });
  };
  const remove = () => {
    const pos = getPos();
    editor
      .chain()
      .focus()
      .deleteRange({ from: pos, to: pos + node.nodeSize })
      .run();
  };

  return (
    <NodeViewWrapper className={'img-wrap align-' + align + (selected ? ' sel' : '')} data-drag-handle>
      <img
        src={node.attrs.src}
        alt={node.attrs.alt ?? ''}
        style={{
          transform: `rotate(${rotation}deg)`,
          width: `${width}px`,
          height: height ? `${height}px` : 'auto',
          maxWidth: '100%',
        }}
        draggable={false}
      />
      {selected && (
        <div className="img-tools" contentEditable={false}>
          <button title="逆时针旋转" onClick={() => rotate(-15)}>
            ↺
          </button>
          <button title="顺时针旋转" onClick={() => rotate(15)}>
            ↻
          </button>
          <button title="缩小" onClick={() => scale(-30)}>
            －
          </button>
          <button title="放大" onClick={() => scale(30)}>
            ＋
          </button>
          <button title="删除图片" onClick={remove} aria-label="删除图片">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 6h18" />
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
            </svg>
          </button>
        </div>
      )}
    </NodeViewWrapper>
  );
}
