// Fluent UI System Icons — 内联 SVG（line 风格，currentColor 描边）
// 采用 Fluent 官方图标几何（24x24 视图框，1.6 描边），不引入额外依赖，离线可构建。
import type { CSSProperties, ReactNode } from 'react';

type IconProps = { size?: number; className?: string; style?: CSSProperties };

export function Svg({ size = 20, className, style, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/* 实体库 — 书 */
export function IconEntities(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H18a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H6.5A1.5 1.5 0 0 1 5 19.5v-15Z" />
      <path d="M9 3v15.5" />
      <path d="M12.5 6.5h4.5M12.5 10h4.5M12.5 13.5h4.5" />
    </Svg>
  );
}

/* 线索板 — 节点图谱（实体关系网，三点互联） */
export function IconRelations(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="6" r="2.4" />
      <circle cx="6.5" cy="17" r="2.4" />
      <circle cx="17.5" cy="17" r="2.4" />
      <path d="M12 8.4 8.9 15.6M12 8.4l2.1 7.2M8.9 17h7.2" />
    </Svg>
  );
}

/* 一致性检查 — 勾选圆 */
export function IconConsistency(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.4 12.2l2.4 2.3 4.6-4.8" />
    </Svg>
  );
}

/* 协作与分享 — 双人 */
export function IconShare(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.6 19a5.4 5.4 0 0 1 10.8 0" />
      <path d="M16 6.2a3 3 0 0 1 0 5.6" />
      <path d="M16.8 14.2A5.4 5.4 0 0 1 20.4 19" />
    </Svg>
  );
}

/* 设置 — 齿轮（八芒） */
export function IconSettings(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
      <path d="M4.9 4.9l2.1 2.1M16.9 16.9l2.1 2.1M19.1 4.9l-2.1 2.1M7.1 16.9l-2.1 2.1" />
    </Svg>
  );
}

/* 文件树开关 — 面板 */
export function IconPanel(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </Svg>
  );
}

/* AI 侧栏开关 — 火花 */
export function IconCopilot(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3l1.8 4.8L18 9.6l-4.2 1.8L12 16l-1.8-4.6L6 9.6l4.2-1.8L12 3Z" />
      <path d="M18 14.5l.7 1.9L20.5 17l-1.8.6L18 19.5l-.7-1.9L15.5 17l1.8-.6L18 14.5Z" />
    </Svg>
  );
}

/* 保存 — 软盘 */
export function IconSave(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 3h11l3 3v15H5V3Z" />
      <path d="M8 3v5h7V3" />
      <path d="M8 13h8v7H8z" />
    </Svg>
  );
}

/* 文档 — 文件 */
export function IconDoc(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 2h8l4 4v16H6V2Z" />
      <path d="M14 2v4h4" />
      <path d="M9 13h6M9 16.5h6" />
    </Svg>
  );
}

/* 文件夹 */
export function IconFolder(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2h8A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-15A1.5 1.5 0 0 1 2 17.5v-11Z" />
    </Svg>
  );
}

/* 视觉物料生成器 — 图层 */
export function IconMaterials(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="8.5" cy="10" r="1.5" />
      <path d="M5 17l4.5-4.5 3 3L16 12l3 3" />
    </Svg>
  );
}

/* 时间轴 — 时钟 */
export function IconTimeline(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </Svg>
  );
}

/* 搜索 — 放大镜 */
export function IconSearch(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.5-4.5" />
    </Svg>
  );
}

/* 分屏 — 双栏 */
export function IconSplit(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M12 4v16" />
    </Svg>
  );
}

/* 开始页 — 房子 */
export function IconHome(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M6 10.2V19a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-8.8" />
      <path d="M9.5 20v-5h5v5" />
    </Svg>
  );
}

/* 世界观管理 — 地球 */
export function IconGlobe(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" />
    </Svg>
  );
}

/* 提案中心 — 灯泡（灵感 / 提案） */
export function IconProposals(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V17h5v-1.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3Z" />
      <path d="M9.5 20h5" />
      <path d="M10 22h4" />
    </Svg>
  );
}

/* ===== 编辑器右键菜单专用图标 ===== */

/* 从选区新建实体 — 方框加号 */
export function IconNewEntity(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M12 8v8M8 12h8" />
    </Svg>
  );
}

/* 文本格式 — A + 文本线 */
export function IconTextFormat(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 18 8 6h3l4 12M5.5 14h5" />
      <path d="M15 8h4a2 2 0 0 1 0 4h-4" />
    </Svg>
  );
}

/* 正文（纯文本 T） */
export function IconText(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 6h14M12 6v13" />
    </Svg>
  );
}

/* 加粗 — B */
export function IconBold(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z" />
    </Svg>
  );
}

/* 倾斜 — I */
export function IconItalic(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M10 5h7M7 19h7M14 5 10 19" />
    </Svg>
  );
}

/* 删除线 — S */
export function IconStrike(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M7 6.5A3.5 3.5 0 0 1 10.6 5H15a3 3 0 0 1 1.5 5.6" />
      <path d="M7 17.5A3.5 3.5 0 0 0 10.6 19H15a3 3 0 0 0 1.4-5.6" />
      <path d="M4 11.5h16" />
    </Svg>
  );
}

/* 高亮 — 马克笔 */
export function IconHighlight(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 19h6" />
      <path d="M14 4l6 6-3 3-6-6 3-3Z" />
      <path d="M11 7l6 6" />
    </Svg>
  );
}

/* 代码 — 尖括号 */
export function IconCode(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9 8 5 12l4 4M15 8l4 4-4 4" />
    </Svg>
  );
}

/* 数学 — 求和 Σ */
export function IconMath(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 5h14l-5.5 7L19 19H5" />
    </Svg>
  );
}

/* 注释 — 气泡 */
export function IconComment(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 4V6a1 1 0 0 1 1-1Z" />
    </Svg>
  );
}

/* 橡皮擦 — 清除高亮 */
export function IconEraser(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M7 17 3 13l9-9 5 5-3 3" />
      <path d="M9 15l6-6 2.5 2.5-6 6H9l-2-2Z" />
    </Svg>
  );
}

/* 清除格式 — 带斜杠的文本 */
export function IconClearFormat(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 5h9l-4 9H5z" />
      <path d="M4 11h6" />
      <path d="M3 3l18 18" />
    </Svg>
  );
}

/* 段落设置 — 段落符 ¶ */
export function IconParagraph(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M7 5v14M7 5h6a3 3 0 0 1 0 6H7M12 5v14" />
    </Svg>
  );
}

/* 标题 — H */
export function IconHeading(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 5v14M19 5v14M5 12h14" />
    </Svg>
  );
}

/* 无序列表 */
export function IconListBullet(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <circle cx="4.5" cy="6" r="1" />
      <circle cx="4.5" cy="12" r="1" />
      <circle cx="4.5" cy="18" r="1" />
    </Svg>
  );
}

/* 有序列表 */
export function IconListOrdered(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M10 6h10M10 12h10M10 18h10" />
      <path d="M4 5h1v3M4 6.5h.8M4 11h1v3M4 12.5h.8M4 17h1v3M4 18.5h.8" />
    </Svg>
  );
}

/* 分隔线 */
export function IconHr(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 12h16M6 9v6M18 9v6" />
    </Svg>
  );
}

/* 表格 */
export function IconTable(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <path d="M3 9.3h18M3 14.6h18M9 4v16M15 4v16" />
    </Svg>
  );
}

/* 代码块 */
export function IconCodeBlock(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M9 10l-2 2 2 2M15 10l2 2-2 2" />
    </Svg>
  );
}

/* 剪切 — 剪刀 */
export function IconCut(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="6" cy="6" r="2" />
      <circle cx="6" cy="18" r="2" />
      <path d="M8 7.5 20 18M8 16.5 20 6" />
    </Svg>
  );
}

/* 复制 */
export function IconCopy(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="9" y="9" width="11" height="11" rx="1.5" />
      <path d="M5 15V5a1 1 0 0 1 1-1h9" />
    </Svg>
  );
}

/* 粘贴 */
export function IconPaste(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4V3h6v1M8 9h8M8 13h8M8 17h5" />
    </Svg>
  );
}

/* 以纯文本形式粘贴 — 剪贴板 + A */
export function IconPastePlain(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4V3h6v1M9 10l3-5 3 5M9 13h6M9 17h4" />
    </Svg>
  );
}

/* 全选 — 选框四角 */
export function IconSelectAll(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M4 12h16" />
    </Svg>
  );
}

/* 加号 — 插入 */
export function IconPlus(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

const TAB_ICON_MAP: Record<string, (p: IconProps) => ReactNode> = {
  entities: IconEntities,
  relations: IconRelations,
  consistency: IconConsistency,
  share: IconShare,
  settings: IconSettings,
  doc: IconDoc,
  timeline: IconTimeline,
  materials: IconMaterials,
  drafts: IconDoc,
  home: IconHome,
};

import { ENTITY_LABEL, type EntityType } from '../types';

const ENTITY_ICON_BG: Record<EntityType, string> = {
  character: '#7c3aed',
  faction: '#2563eb',
  location: '#059669',
  event: '#d97706',
  rule: '#dc2626',
};

/** 标签/搜索结果图标：已知 Fluent 键 → SVG；实体类型 → 色块首字；其他/空 → 默认圆点 */
export function TabIcon({ icon, size = 14 }: { icon?: string; size?: number }) {
  if (!icon) return <span className="tab-icon-fallback" style={{ width: size, height: size, borderRadius: '50%', background: 'var(--muted)', display: 'inline-block' }} />;
  const C = TAB_ICON_MAP[icon];
  if (C) return <C size={size} />;
  const et = icon as EntityType;
  if (ENTITY_LABEL[et]) {
    return (
      <span
        className="tab-icon-entity"
        style={{
          width: size, height: size, borderRadius: 4,
          background: ENTITY_ICON_BG[et],
          color: '#fff', fontSize: Math.max(9, size - 4),
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 600, lineHeight: 1,
        }}
      >
        {ENTITY_LABEL[et].charAt(0)}
      </span>
    );
  }
  return <span className="tab-icon-fallback" style={{ width: size, height: size, borderRadius: '50%', background: 'var(--muted)', display: 'inline-block' }} />;
}
