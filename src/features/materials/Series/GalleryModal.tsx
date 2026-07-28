// ============================================================
// 视觉物料生成器 · 会话画廊弹窗（P3-B）
// ------------------------------------------------------------
// 展示当前会话内批量 / 套系 / 单张导出推入的物料缩略图，
// 可单独下载 PNG 或清空。内存态（持久化属 P3-D 市场范畴）。
// ============================================================

import { useGalleryStore } from './galleryStore';

function downloadDataUrl(name: string, dataUrl: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = name.endsWith('.png') ? name : `${name}.png`;
  a.click();
}

export function GalleryModal({ onClose }: { onClose: () => void }) {
  const items = useGalleryStore((s) => s.items);
  const remove = useGalleryStore((s) => s.remove);
  const clear = useGalleryStore((s) => s.clear);

  return (
    <div className="mf-modal-backdrop" onClick={onClose}>
      <div className="mf-modal mf-gallery-modal" onClick={(e) => e.stopPropagation()}>
        <div className="mf-modal-head">
          <div className="mf-modal-title">物料画廊（{items.length}）</div>
          <button className="mf-modal-x" onClick={onClose} title="关闭">×</button>
        </div>
        <div className="mf-gallery-body">
          {items.length === 0 ? (
            <div className="mf-empty">暂无物料。批量生成 / 套系矩阵 / 单张导出后会自动收入此处。</div>
          ) : (
            <div className="mf-gallery-grid">
              {items.map((it) => (
                <div className="mf-gallery-item" key={it.id}>
                  <img src={it.dataUrl} alt={it.label} title={it.label} />
                  <div className="mf-gallery-cap" title={it.label}>{it.label}</div>
                  <div className="mf-gallery-ops">
                    <button className="mf-gallery-dl" onClick={() => downloadDataUrl(it.label, it.dataUrl)}>下载</button>
                    <button className="mf-gallery-rm" onClick={() => remove(it.id)}>删</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {items.length > 0 && (
          <div className="mf-gallery-foot">
            <button className="mf-link-btn" onClick={clear}>清空画廊</button>
          </div>
        )}
      </div>
    </div>
  );
}
