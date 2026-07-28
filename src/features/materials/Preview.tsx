// ============================================================
// 视觉物料生成器 · 共享预览组件（P0-2 / P3-C 抽离复用）
// ------------------------------------------------------------
// 中栏预览：在 React 实时渲染之外叠加纹理 / Logo / 水印，
// 与 previewToHtml 的离屏渲染保持视觉一致（WYSIWYG）。
// 供 MaterialForgeView 与 TemplateEditor 共用，避免双份实现漂移。
// ============================================================

import type { MaterialTemplate, StyleToken } from './types';
import { SIZE_PRESETS } from './types';
import type { RenderContext } from './bindings';
import { textureBackground } from './previewToHtml';

const MM_TO_PX = 96 / 25.4;
const mmToPx = (mm: number) => Math.round(mm * MM_TO_PX);

function pagePixelSize(template: MaterialTemplate, token: StyleToken) {
  const preset = template.pageOverride ? SIZE_PRESETS.find((p) => p.key === template.pageOverride) : undefined;
  if (preset && preset.key !== 'custom') {
    return { w: mmToPx(preset.w), h: mmToPx(preset.h) };
  }
  return { w: mmToPx(token.layout.widthMm), h: mmToPx(token.layout.heightMm) };
}

function logoRadius(shape: StyleToken['logo']['shape']): string {
  switch (shape) {
    case 'circle':
    case 'ellipse':
      return '50%';
    case 'square':
      return '8px';
    case 'rect':
      return '4px';
    case 'line':
    default:
      return '0';
  }
}

export function MaterialPreview({
  token, header, template, ctx, scale, highlightId,
}: {
  token: StyleToken;
  header: string;
  template: MaterialTemplate;
  ctx: RenderContext;
  scale: number;
  highlightId?: string;
}) {
  const page = pagePixelSize(template, token);
  const texBg = textureBackground(token.texture);
  const watermark = token.layout.watermark?.trim() ?? '';
  const logoSrc = token.logo.src.trim();
  const bg = template.background;
  const pageBg = bg?.color ?? token.palette.paper;

  const bgImageLayer = bg?.image ? (
    <div
      style={{
        position: 'absolute', inset: 0, zIndex: 0,
        backgroundImage: `url(${bg.image})`,
        backgroundSize: bg.imageSize ?? 'cover',
        backgroundPosition: bg.imagePosition ?? 'center',
        backgroundRepeat: bg.imageRepeat ?? 'no-repeat',
        opacity: bg.imageOpacity ?? 1,
        pointerEvents: 'none',
      }}
    />
  ) : null;
  const logoNode = logoSrc ? (
    logoSrc.startsWith('<svg') ? (
      <div
        key="logo"
        style={{
          position: 'absolute', top: 10, right: 10, zIndex: 3,
          width: token.logo.size, height: token.logo.size,
          borderRadius: logoRadius(token.logo.shape), overflow: 'hidden',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
        dangerouslySetInnerHTML={{ __html: token.logo.src }}
      />
    ) : (
      <img
        key="logo"
        src={token.logo.src}
        alt=""
        style={{
          position: 'absolute', top: 10, right: 10, zIndex: 3,
          width: token.logo.size, height: token.logo.size,
          borderRadius: logoRadius(token.logo.shape), objectFit: 'contain',
        }}
      />
    )
  ) : null;

  return (
    <div
      style={{
        width: Math.round(page.w * scale),
        height: Math.round(page.h * scale),
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'flex-start',
      }}
    >
      <div
        className="mf-preview-frame"
        style={{
          width: page.w,
          height: page.h,
          background: pageBg,
          color: token.palette.ink,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          fontFamily: token.typography.bodyFont,
          position: 'relative',
        }}
      >
        {bgImageLayer}
        {texBg && (
          <div
            style={{
              position: 'absolute', inset: 0, background: texBg, zIndex: 1,
              opacity: token.texture.opacity, mixBlendMode: token.texture.blend, pointerEvents: 'none',
            }}
          />
        )}
        {watermark && (
          <div
            style={{
              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1,
              transform: 'rotate(-28deg)', fontFamily: token.typography.titleFont,
              fontSize: 64, color: token.palette.muted, opacity: 0.06,
              whiteSpace: 'nowrap', overflow: 'hidden', pointerEvents: 'none',
            }}
          >
            {watermark}
          </div>
        )}
        {logoNode}
        <div style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <div
            className="mf-pv-header"
            style={{ background: token.palette.accent, color: '#fff', fontFamily: token.typography.titleFont }}
          >
            {header}
          </div>
          <div className="mf-pv-body" style={{ flex: 1 }}>
            {/* 实时 Block 渲染交给调用方通过 children 注入，保持组件聚焦"纸张外壳" */}
            {template && ctx ? (
              <TemplateBody template={template} ctx={ctx} highlightId={highlightId} />
            ) : null}
          </div>
          <div className="mf-pv-footer" style={{ color: token.palette.muted }}>
            {token.layout.footer}
          </div>
        </div>
      </div>
    </div>
  );
}

// 局部引入 TemplateRenderer 以避免与渲染器形成循环；用 React.lazy 不必要，直接 import。
import { TemplateRenderer } from './TemplateRenderer';
function TemplateBody({ template, ctx, highlightId }: { template: MaterialTemplate; ctx: RenderContext; highlightId?: string }) {
  return <TemplateRenderer template={template} ctx={ctx} highlightId={highlightId} />;
}
