// ============================================================
// 视觉物料生成器 · 模板渲染器（P0-5）
// ------------------------------------------------------------
// 把 MaterialTemplate.blocks（声明式 Block 树）按 StyleToken 渲染成
// 真实版式。所有取值都经 bindings.ts 解析（七源绑定 + 插值 +
// 语气词典 + 头像三模式）。渲染结果即中栏预览，也是 P0-6/7
// 导出/截图的源 DOM。
// ============================================================

import type { Block, MaterialTemplate, StyleToken, FieldBinding } from './types';
import {
  RenderContext, interpolate, applyTone, resolveBinding,
  resolveShowIf, resolveTableRows, resolveCell, resolveRepeatEntities,
  resolveSpectrumColor,
} from './bindings';
import {
  parseChartData, parseFlowSteps, generateQRMatrix, qrMatrixToPath,
  getBuiltinIconPath, getShapePath, chartColors,
} from './renderHelpers';

/* ---------- 行内样式 ---------- */
function groupStyle(b: Extract<Block, { type: 'group' }>, _token: StyleToken): React.CSSProperties {
  const base = {
    display: 'flex',
    flexDirection: b.direction === 'col' ? 'column' : 'row',
  } as Record<string, string | number>;
  return { ...base, ...(b.style ?? {}) } as unknown as React.CSSProperties;
}

function textStyle(role: string | undefined, token: StyleToken): React.CSSProperties {
  switch (role) {
    case 'title': return { fontFamily: token.typography.titleFont, fontSize: token.typography.titleSize, fontWeight: 700, lineHeight: 1.2 };
    case 'body': return { fontFamily: token.typography.bodyFont, fontSize: token.typography.bodySize };
    case 'label': return { fontFamily: token.typography.bodyFont, fontSize: token.typography.labelSize, color: token.palette.muted };
    case 'value': return { fontFamily: token.typography.bodyFont, fontSize: token.typography.bodySize, fontWeight: 600 };
    case 'caption': return { fontFamily: token.typography.bodyFont, fontSize: Math.max(10, token.typography.labelSize - 1), color: token.palette.muted, fontStyle: 'italic' };
    default: return { fontFamily: token.typography.bodyFont, fontSize: token.typography.bodySize };
  }
}

/* ---------- 高亮辅助 ---------- */
const HIGHLIGHT_STYLE: React.CSSProperties = {
  outline: '2px solid #f43f5e',
  outlineOffset: 1,
  backgroundColor: 'rgba(244, 63, 94, 0.10)',
};
function hl(style: React.CSSProperties, active: boolean): React.CSSProperties {
  return active ? { ...style, ...HIGHLIGHT_STYLE } : style;
}

/* ---------- 单块渲染 ---------- */
function renderBlock(b: Block, ctx: RenderContext, key: string, highlightId?: string): React.ReactNode {
  if (b.showIf && !resolveShowIf(b.showIf, ctx)) return null;
  const isHL = b.id === highlightId;
  const dataProps = { 'data-block-id': b.id } as any;

  switch (b.type) {
    case 'group':
      return (
        <div key={key} className="mf-b-group" {...dataProps} style={hl(groupStyle(b, ctx.token), isHL)}>
          {b.blocks.map((c, i) => renderBlock(c, ctx, `${key}-${i}`, highlightId))}
        </div>
      );

    case 'text': {
      const raw = b.content ?? '';
      const resolved = raw.includes('{')
        ? interpolate(raw, ctx)
        : (b.binding ? resolveBinding(b.binding, ctx) : raw);
      const text = applyTone(resolved, ctx.token);
      if (!text.trim()) return null;
      return <div key={key} className="mf-b-text" {...dataProps} style={hl(textStyle(b.role, ctx.token), isHL)}>{text}</div>;
    }

    case 'image': {
      const src = b.binding ? resolveBinding(b.binding, ctx) : '';
      const w = b.width ?? 96;
      const h = b.height ?? 96;
      const frame: React.CSSProperties = {
        width: w, height: h, objectFit: 'cover',
        borderRadius: b.round ? '50%' : 4,
        border: `1px solid ${ctx.token.palette.muted}55`,
        background: '#00000008',
      };
      return (
        <div key={key} className="mf-b-image" {...dataProps} style={hl({ width: w, height: h, flexShrink: 0 }, isHL)}>
          {src
            ? <img src={src} alt="" style={frame} />
            : <div style={{ ...frame, display: 'flex', alignItems: 'center', justifyContent: 'center', color: ctx.token.palette.muted, fontSize: 11 } as React.CSSProperties}>{b.placeholder ?? '图'}</div>}
        </div>
      );
    }

    case 'divider':
      return <hr key={key} className="mf-b-divider" {...dataProps} style={hl({ border: 'none', borderTop: `1px solid ${ctx.token.palette.muted}55`, margin: '10px 0' }, isHL)} />;

    case 'barcode': {
      const code = b.binding ? resolveBinding(b.binding, ctx) : '';
      return (
        <div key={key} className="mf-b-barcode" {...dataProps} style={hl({}, isHL)}>
          <div className="mf-barcode-bars" style={{ backgroundSize: `${10 + (code.length % 9) * 2}px 100%` }} />
          <div style={{ fontFamily: ctx.token.typography.monoFont, fontSize: ctx.token.typography.labelSize, color: ctx.token.palette.muted, letterSpacing: 1 }}>{code}</div>
        </div>
      );
    }

    case 'signature': {
      const src = b.binding ? resolveBinding(b.binding, ctx) : '';
      const hasImageSrc = ctx.token.signature.imageSrc && ctx.token.signature.imageSrc.trim().length > 0;
      const mode = ctx.token.signature.mode || 'auto';
      const imgH = ctx.token.signature.imageHeight ?? 40;

      let imageSrc: string | undefined;
      let textSrc: string | undefined;

      if (mode === 'image') {
        imageSrc = hasImageSrc ? ctx.token.signature.imageSrc : undefined;
      } else if (mode === 'text') {
        textSrc = src || undefined;
      } else {
        // auto：优先图片；binding 值本身是图片时也按图片渲染
        if (hasImageSrc) imageSrc = ctx.token.signature.imageSrc;
        else if (/^data:|^https?:|^<svg/i.test(src || '')) imageSrc = src;
        else textSrc = src || undefined;
      }

      return (
        <div key={key} className="mf-b-sign" {...dataProps} style={hl({}, isHL)}>
          {b.label && <div style={{ fontSize: ctx.token.typography.labelSize, color: ctx.token.palette.muted, marginBottom: 2 }}>{b.label}</div>}
          {imageSrc ? (
            imageSrc.trim().startsWith('<svg')
              ? <div dangerouslySetInnerHTML={{ __html: imageSrc }} style={{ height: imgH }} />
              : <img src={imageSrc} alt="" style={{ height: imgH, objectFit: 'contain' }} />
          ) : (
            <div style={{ fontFamily: ctx.token.signature.font, color: ctx.token.signature.color, fontStyle: ctx.token.signature.italic ? 'italic' : 'normal', fontSize: 20 }}>
              {textSrc || '—'}
            </div>
          )}
        </div>
      );
    }

    case 'spectrum': {
      const color = resolveSpectrumColor(b as any, ctx);
      return (
        <div key={key} className="mf-b-spectrum" {...dataProps} style={hl({}, isHL)} title={color}>
          <div style={{ width: 46, height: 10, borderRadius: 5, background: color || 'transparent', border: `1px solid ${ctx.token.palette.muted}55` }} />
          <span style={{ fontSize: ctx.token.typography.labelSize, color: ctx.token.palette.muted }}>{color || '—'}</span>
        </div>
      );
    }

    case 'table': {
      const rows = resolveTableRows(b, ctx);
      return (
        <table key={key} className="mf-b-table" {...dataProps} style={hl({ width: '100%', borderCollapse: 'collapse', fontFamily: ctx.token.typography.bodyFont, fontSize: ctx.token.typography.bodySize }, isHL)}>
          <thead>
            <tr>
              {b.columns.map((c, i) => (
                <th key={i} style={{ textAlign: 'left', borderBottom: `1px solid ${ctx.token.palette.muted}88`, padding: '4px 6px', color: ctx.token.palette.muted, fontSize: ctx.token.typography.labelSize, fontWeight: 600 }}>{c.header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>
                {b.columns.map((c, ci) => (
                  <td key={ci} style={{ padding: '4px 6px', borderBottom: `1px solid ${ctx.token.palette.muted}33`, verticalAlign: 'top' }}>
                    {applyTone(resolveCell(c.binding, ctx, r), ctx.token)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }

    case 'icon': {
      const s = b.size ?? 20;
      const path = getBuiltinIconPath(b.iconKey) ?? getBuiltinIconPath('star')!;
      return (
        <div key={key} className="mf-b-icon" {...dataProps} style={hl({ width: s, height: s, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: b.rotate ? `rotate(${b.rotate}deg)` : undefined }, isHL)}>
          <svg width={s} height={s} viewBox="0 0 24 24" fill={b.color ?? ctx.token.palette.accent}>
            <path d={path} />
          </svg>
        </div>
      );
    }

    case 'shape': {
      const w = b.width ?? 80;
      const h = b.height ?? 40;
      const fill = b.fill ?? ctx.token.palette.accent;
      const stroke = b.stroke ?? ctx.token.palette.ink;
      const sw = b.strokeWidth ?? 0;
      const d = getShapePath(b.shape, w, h, b.borderRadius ?? 0);
      const transform = b.rotation ? `rotate(${b.rotation} ${w / 2} ${h / 2})` : undefined;
      return (
        <div key={key} className="mf-b-shape" {...dataProps} style={hl({ width: w, height: h, flexShrink: 0 }, isHL)}>
          <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ overflow: 'visible' }}>
            <path d={d} fill={b.shape === 'line' ? 'none' : fill} stroke={stroke} strokeWidth={b.shape === 'line' ? (sw || 2) : sw} transform={transform} />
          </svg>
        </div>
      );
    }

    case 'chart': {
      const raw = b.binding ? resolveBinding(b.binding, ctx) : '';
      const data = parseChartData(raw || b.staticData || '');
      if (data.length === 0) return null;
      const W = b.width ?? 260;
      const H = b.height ?? 160;
      const pad = { top: 10, right: 10, bottom: 24, left: 32 };
      const cw = W - pad.left - pad.right;
      const ch = H - pad.top - pad.bottom;
      const max = Math.max(...data.map((d) => d.value), 1);
      const colors = chartColors(b.color ?? ctx.token.palette.accent, data.length);
      const labelColor = ctx.token.palette.muted;
      const fontSize = 10;

      if (b.kind === 'pie' || b.kind === 'donut') {
        const total = data.reduce((a, d) => a + d.value, 0) || 1;
        const radius = Math.min(cw, ch) / 2;
        const cx = W / 2;
        const cy = H / 2;
        let start = -Math.PI / 2;
        const slices = data.map((d, i) => {
          const angle = (d.value / total) * Math.PI * 2;
          const end = start + angle;
          const x1 = cx + radius * Math.cos(start);
          const y1 = cy + radius * Math.sin(start);
          const x2 = cx + radius * Math.cos(end);
          const y2 = cy + radius * Math.sin(end);
          const large = angle > Math.PI ? 1 : 0;
          const path = `M${cx},${cy}L${x1},${y1}A${radius},${radius} 0 ${large},1 ${x2},${y2}Z`;
          const mid = start + angle / 2;
          const labelR = radius * 0.65;
          const slice = { path, color: colors[i], label: d.label, lx: cx + labelR * Math.cos(mid), ly: cy + labelR * Math.sin(mid) };
          start = end;
          return slice;
        });
        const innerR = b.kind === 'donut' ? radius * 0.55 : 0;
        return (
          <div key={key} className="mf-b-chart" {...dataProps} style={hl({ width: W, height: H, flexShrink: 0 }, isHL)}>
            <svg width={W} height={H}>
              {slices.map((s, i) => <path key={i} d={s.path} fill={s.color} stroke="#fff" strokeWidth={1} />)}
              {innerR > 0 && <circle cx={cx} cy={cy} r={innerR} fill={ctx.token.palette.paper} />}
              {slices.map((s, i) => (
                <text key={`l-${i}`} x={s.lx} y={s.ly} textAnchor="middle" dominantBaseline="middle" fontSize={fontSize} fill={labelColor}>{s.label}</text>
              ))}
            </svg>
          </div>
        );
      }

      if (b.kind === 'radar') {
        const cx = W / 2;
        const cy = H / 2;
        const radius = Math.min(W, H) / 2 - 34;
        const levels = 4;
        const angleStep = (Math.PI * 2) / data.length;
        const maxVal = Math.max(...data.map((d) => d.value), 1);
        const mainColor = b.color ?? ctx.token.palette.accent;

        const gridPolys = [];
        for (let lv = 1; lv <= levels; lv++) {
          const r = (radius * lv) / levels;
          const pts = data.map((_, i) => {
            const angle = -Math.PI / 2 + i * angleStep;
            return `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`;
          }).join(' ');
          gridPolys.push(<polygon key={lv} points={pts} fill="none" stroke={labelColor} strokeWidth={0.5} opacity={0.5} />);
        }

        const axes = data.map((_, i) => {
          const angle = -Math.PI / 2 + i * angleStep;
          return (
            <line key={i} x1={cx} y1={cy}
              x2={cx + radius * Math.cos(angle)} y2={cy + radius * Math.sin(angle)}
              stroke={labelColor} strokeWidth={0.5} opacity={0.5} />
          );
        });

        const dataPts = data.map((d, i) => {
          const angle = -Math.PI / 2 + i * angleStep;
          const r = (d.value / maxVal) * radius;
          return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
        });
        const dataPoly = dataPts.map((p) => `${p.x},${p.y}`).join(' ');

        const labels = data.map((d, i) => {
          const angle = -Math.PI / 2 + i * angleStep;
          const lx = cx + (radius + 16) * Math.cos(angle);
          const ly = cy + (radius + 16) * Math.sin(angle);
          return <text key={i} x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fontSize={fontSize} fill={labelColor}>{d.label}</text>;
        });

        return (
          <div key={key} className="mf-b-chart" {...dataProps} style={hl({ width: W, height: H, flexShrink: 0 }, isHL)}>
            <svg width={W} height={H}>
              {gridPolys}
              {axes}
              <polygon points={dataPoly} fill={`${mainColor}40`} stroke={mainColor} strokeWidth={2} />
              {dataPts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={3} fill={colors[i]} />)}
              {labels}
            </svg>
          </div>
        );
      }

      // bar / line
      const barW = data.length > 0 ? cw / data.length * 0.6 : 0;
      const step = data.length > 1 ? cw / (data.length - 1) : cw;
      return (
        <div key={key} className="mf-b-chart" {...dataProps} style={hl({ width: W, height: H, flexShrink: 0 }, isHL)}>
          <svg width={W} height={H}>
            {/* 坐标轴 */}
            <line x1={pad.left} y1={pad.top} x2={pad.left} y2={H - pad.bottom} stroke={labelColor} strokeWidth={1} />
            <line x1={pad.left} y1={H - pad.bottom} x2={W - pad.right} y2={H - pad.bottom} stroke={labelColor} strokeWidth={1} />
            {/* 0 刻度 */}
            <text x={pad.left - 4} y={H - pad.bottom} textAnchor="end" dominantBaseline="middle" fontSize={fontSize} fill={labelColor}>0</text>
            <text x={pad.left - 4} y={pad.top + 4} textAnchor="end" dominantBaseline="middle" fontSize={fontSize} fill={labelColor}>{max}</text>
            {b.kind === 'bar' && data.map((d, i) => {
              const bh = (d.value / max) * ch;
              const x = pad.left + (cw / data.length) * i + (cw / data.length - barW) / 2;
              const y = H - pad.bottom - bh;
              return (
                <g key={i}>
                  <rect x={x} y={y} width={barW} height={bh} fill={colors[i]} rx={2} />
                  <text x={x + barW / 2} y={H - pad.bottom + 12} textAnchor="middle" fontSize={fontSize} fill={labelColor}>{d.label}</text>
                </g>
              );
            })}
            {b.kind === 'line' && (
              <>
                <polyline
                  fill="none"
                  stroke={b.color ?? ctx.token.palette.accent}
                  strokeWidth={2}
                  points={data.map((d, i) => {
                    const x = pad.left + step * i;
                    const y = H - pad.bottom - (d.value / max) * ch;
                    return `${x},${y}`;
                  }).join(' ')}
                />
                {data.map((d, i) => {
                  const x = pad.left + step * i;
                  const y = H - pad.bottom - (d.value / max) * ch;
                  return (
                    <g key={i}>
                      <circle cx={x} cy={y} r={3} fill={colors[i]} />
                      <text x={x} y={H - pad.bottom + 12} textAnchor="middle" fontSize={fontSize} fill={labelColor}>{d.label}</text>
                    </g>
                  );
                })}
              </>
            )}
          </svg>
        </div>
      );
    }

    case 'flowchart': {
      const raw = b.binding ? resolveBinding(b.binding, ctx) : '';
      const steps = parseFlowSteps(raw || b.staticSteps || '');
      if (steps.length === 0) return null;
      const dir = b.direction ?? 'row';
      const isRow = dir === 'row';
      const boxW = 80;
      const boxH = 36;
      const gap = 24;
      const W = isRow ? steps.length * boxW + (steps.length - 1) * gap + 16 : boxW + 16;
      const H = isRow ? boxH + 16 : steps.length * boxH + (steps.length - 1) * gap + 16;
      const stepColor = b.stepColor ?? ctx.token.palette.accent;
      const arrowColor = b.arrowColor ?? ctx.token.palette.muted;
      const textColor = '#fff';
      return (
        <div key={key} className="mf-b-flowchart" {...dataProps} style={hl({ width: W, height: H, flexShrink: 0 }, isHL)}>
          <svg width={W} height={H}>
            {steps.map((s, i) => {
              const x = isRow ? 8 + i * (boxW + gap) : (W - boxW) / 2;
              const y = isRow ? (H - boxH) / 2 : 8 + i * (boxH + gap);
              return (
                <g key={i}>
                  <rect x={x} y={y} width={boxW} height={boxH} rx={6} fill={stepColor} />
                  <text x={x + boxW / 2} y={y + boxH / 2} textAnchor="middle" dominantBaseline="middle" fontSize={11} fill={textColor}>{s}</text>
                  {i < steps.length - 1 && (
                    isRow
                      ? <path d={`M${x + boxW},${y + boxH / 2}L${x + boxW + gap - 6},${y + boxH / 2}M${x + boxW + gap - 10},${y + boxH / 2 - 4}L${x + boxW + gap - 6},${y + boxH / 2}L${x + boxW + gap - 10},${y + boxH / 2 + 4}`} stroke={arrowColor} strokeWidth={1.5} fill="none" />
                      : <path d={`M${x + boxW / 2},${y + boxH}L${x + boxW / 2},${y + boxH + gap - 6}M${x + boxW / 2 - 4},${y + boxH + gap - 10}L${x + boxW / 2},${y + boxH + gap - 6}L${x + boxW / 2 + 4},${y + boxH + gap - 10}`} stroke={arrowColor} strokeWidth={1.5} fill="none" />
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      );
    }

    case 'qrcode': {
      const raw = b.binding ? resolveBinding(b.binding, ctx) : '';
      const value = raw || b.staticValue || ' ';
      const size = b.size ?? 120;
      const color = b.color ?? '#1a1a1a';
      const bg = b.bgColor ?? '#ffffff';
      const matrix = generateQRMatrix(value);
      const path = qrMatrixToPath(matrix, size);
      return (
        <div key={key} className="mf-b-qrcode" {...dataProps} style={hl({ width: size, height: size, flexShrink: 0, background: bg }, isHL)}>
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            <rect width={size} height={size} fill={bg} />
            <path d={path} fill={color} />
          </svg>
        </div>
      );
    }

    case 'repeat': {
      const items = resolveRepeatEntities(b, ctx);
      if (items.length === 0) return null;
      return (
        <div key={key} className="mf-b-repeat" {...dataProps} style={hl({ ...(b.style ?? {}) } as React.CSSProperties, isHL)}>
          {items.map((ent, i) => {
            const subCtx: RenderContext = { ...ctx, entity: ent };
            return (
              <div key={i} className="mf-b-repeat-item">
                {b.itemTemplate.map((c, ci) => renderBlock(c, subCtx, `${key}-${i}-${ci}`, highlightId))}
              </div>
            );
          })}
        </div>
      );
    }

    case 'slot':
      return null;

    default:
      return null;
  }
}

/* ---------- 模板渲染入口 ---------- */
export function TemplateRenderer({ template, ctx, highlightId }: { template: MaterialTemplate; ctx: RenderContext; highlightId?: string }) {
  return (
    <div className="mf-render">
      {template.blocks.map((b, i) => renderBlock(b, ctx, `b${i}`, highlightId))}
    </div>
  );
}
