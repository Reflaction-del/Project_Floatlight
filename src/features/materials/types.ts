// ============================================================
// 视觉物料生成器 · 核心类型系统（P0-1）
// ------------------------------------------------------------
// 这些类型把「任意世界观的美术风格」拆成可参数化、可反推、可校验的
// 结构，是「支持任意世界观」的关键地基。本文件为纯类型定义 + 默认工厂，
// 不依赖任何 React / Electron 运行时，便于渲染引擎、一致性校验、序列化共用。
// ============================================================

/* ============================================================
 * 一、风格令牌（StyleToken）
 * 把"美术风格"拆成 8 个可独立调节的维度。
 * ============================================================ */

/** 配色：纸张 / 墨色 / 强调 / 次要 / 警示 / 提示 / 条形码 */
export interface PaletteToken {
  paper: string;   // 纸张底色（如 '#f5f3ec'）
  ink: string;     // 主文字色（如 '#1a1a1a'）
  accent: string;  // 机构 / 世界观主色（如 '#1f3a5f'）
  muted: string;   // 次要 / 辅助文字色
  danger: string;  // 警示 / 危险色
  warn: string;    // 提示 / 注意色
  barcode?: string; // 条形码 / 编号专用色
}

/** 字体：标题 / 正文 / 等宽编号，及基准字号 */
export interface TypographyToken {
  titleFont: string;     // CSS font-family，如 '"Noto Serif SC", serif'
  bodyFont: string;      // 正文 / 字段字体
  monoFont: string;      // 编号 / 代码 / 数据字体
  titleSize: number;     // 标题基准字号(px)
  bodySize: number;      // 正文基准字号(px)
  labelSize: number;     // 字段标签字号(px)
}

/** 纸张纹理 */
export type TextureKey = 'none' | 'grid' | 'paper' | 'scanline' | 'noise' | 'dots' | 'lined' | 'stamp';
export interface TextureToken {
  key: TextureKey;
  opacity: number;                       // 0-1 纹理不透明度
  blend: 'normal' | 'multiply' | 'overlay';
}

/** 图标库：一组可被模板引用的图标资源 */
export interface IconToken {
  set: string;                           // 图标集名（如 'hri-skull' / 'line' / 'pixel'）
  assets: { key: string; src: string; label?: string }[]; // src 为 inline svg 或 dataURL
}

/** 机构 / 世界观主 Logo */
export interface LogoToken {
  src: string;                          // 主 Logo（inline svg 文本或 dataURL）
  srcInvert?: string;                    // 反色版本（深色底用）
  shape: 'circle' | 'ellipse' | 'square' | 'rect' | 'line';
  size: number;                         // px
}

/** 签名 / 印章水印样式 */
export interface SignatureToken {
  font: string;
  color: string;
  italic: boolean;
  imageSrc?: string;        // 印章 / 签名图片（dataURL 或 inline SVG）
  imageHeight?: number;     // 图片显示高度（px，默认 40）
  mode?: 'text' | 'image' | 'auto'; // 渲染模式：auto=有图片优先图片
}

/** 版式：画幅、边距、页眉页脚、水印文案（支持 {worldName} 占位） */
export type PageKind = 'A4' | 'A5' | 'A6' | 'square' | 'id_card' | 'poster' | 'custom';
export const SIZE_PRESETS: { key: PageKind; label: string; w: number; h: number }[] = [
  { key: 'A4', label: 'A4 · 210×297mm', w: 210, h: 297 },
  { key: 'A5', label: 'A5 · 148×210mm', w: 148, h: 210 },
  { key: 'A6', label: 'A6 · 105×148mm', w: 105, h: 148 },
  { key: 'square', label: '方形 · 210×210mm', w: 210, h: 210 },
  { key: 'id_card', label: '证件卡 · 85.6×54mm', w: 85.6, h: 54 },
  { key: 'poster', label: '海报 · 420×594mm', w: 420, h: 594 },
  { key: 'custom', label: '跟随当前风格版式', w: 0, h: 0 },
];
export interface LayoutToken {
  page: PageKind;
  widthMm: number;
  heightMm: number;
  marginMm: number;
  paddingMm: number;
  header?: string;       // 页眉模板，如 'PG309 // {worldName}'
  footer?: string;       // 页脚模板
  watermark?: string;    // 背景水印文案
}

/** 语气词典：把通用模板里的占位术语替换成世界观专属词 */
export interface ToneWord {
  from: string;         // 通用占位词（如 '实验体'）
  to: string;           // 世界观内术语（如 'Subject'）
}
export type ToneRegister = 'formal' | 'playful' | 'cold' | 'absurd';
export interface ToneToken {
  register: ToneRegister;
  dictionary: ToneWord[];
}

/** 风格令牌聚合 */
export interface StyleToken {
  palette: PaletteToken;
  typography: TypographyToken;
  texture: TextureToken;
  icon: IconToken;
  logo: LogoToken;
  signature: SignatureToken;
  layout: LayoutToken;
  tone: ToneToken;
}

/* ============================================================
 * 二、命名风格预设（MaterialStyle）
 * 一个可被用户复用的完整风格，含元数据。
 * ============================================================ */

export interface MaterialStyle {
  id: string;
  name: string;
  tags: string[];                 // 适用世界观关键词（检索 / 推荐）
  description?: string;
  builtin: boolean;               // 内置预设不可删除
  token: StyleToken;
  createdAt: number;
  updatedAt: number;
}

/* ============================================================
 * 三、字段绑定（FieldBinding）
 * 模板里每个槽位的值来源。用户决策 #3：customField 按 key 映射。
 * ============================================================ */

export type BindingSource =
  | 'entity'       // 实体结构化字段（fields[].label 或固定属性 name/emoji/type）
  | 'customField'  // 实体 materialFields 按 key 映射
  | 'field'        // {field:path} 的直观写法，等价于 customField（用户决策 #3 的别名）
  | 'world'        // 世界级信息（worldName 等）
  | 'style'        // 风格令牌（logo / 配色 / 语气词典替换结果）
  | 'static'       // 固定文案
  | 'relation'     // 关系数据（如隶属的势力名）
  | 'image'        // 图片类（头像 / 插图 / Logo 资源）
  | 'ai';          // AI 生成字段（值经 AI 补全后写入 aiValues / materialFields，标「待审核」）

export interface FieldBinding {
  source: BindingSource;
  /** entity: 字段名（如 '身份' / 'name'）；customField: materialFields 的 key；
   *  world: 'worldName'；style: 'logo' | 'accent' 等；image: 资源定位键 */
  path: string;
  /** static 时直接作为文案 */
  static?: string;
  /** 取不到值时的兜底文案 */
  fallback?: string;
}

/* ============================================================
 * 四、模板（MaterialTemplate）
 * 声明式 Block 组件树 + 字段映射，支持条件渲染与循环。
 * 通用引擎：applicableStyles:['*'] 时与任何风格兼容（用户决策 #6）。
 * ============================================================ */

export type BlockType =
  | 'text' | 'image' | 'table' | 'divider'
  | 'icon' | 'barcode' | 'signature' | 'spectrum' | 'slot' | 'group' | 'repeat'
  | 'shape' | 'chart' | 'flowchart' | 'qrcode';

export interface BlockBase {
  id: string;
  type: BlockType;
  /** 条件渲染：绑定值为空 / 不相等时隐藏 */
  showIf?: { source: BindingSource; path: string; notEmpty?: boolean; equals?: string };
  /** 行内样式（CSS 键值），引擎按风格令牌后处理 */
  style?: Partial<Record<string, string | number>>;
}

export interface TextBlock extends BlockBase {
  type: 'text';
  content: string;                // 支持 {field:path} 插值
  binding?: FieldBinding;          // 整体绑定（优先级低于插值）
  role?: 'title' | 'body' | 'label' | 'value' | 'caption';
}
export interface ImageBlock extends BlockBase {
  type: 'image';
  binding: FieldBinding;          // 指向头像 / 插图 / Logo
  placeholder?: string;
  round?: boolean;
  width?: number;
  height?: number;
}
export interface TableBlock extends BlockBase {
  type: 'table';
  columns: { header: string; binding: FieldBinding }[];
  rows: 'entityFields' | 'customFields' | 'static';
  staticRows?: { cells: string[] }[];
}
export interface DividerBlock extends BlockBase { type: 'divider'; }
export interface IconBlock extends BlockBase {
  type: 'icon';
  iconKey: string;
  size?: number;
  color?: string;
  rotate?: number;
}
export interface BarcodeBlock extends BlockBase { type: 'barcode'; binding: FieldBinding; }
export interface SignatureBlock extends BlockBase { type: 'signature'; binding?: FieldBinding; label?: string; }

export type SpectrumColorMode = 'binding' | 'custom' | 'rules';
export interface SpectrumColorRule {
  value: string;               // 检测值
  color: string;               // 命中时显示的颜色
  operator?: 'eq' | 'contains' | 'startsWith' | 'endsWith';
}
export interface SpectrumBlock extends BlockBase {
  type: 'spectrum';
  binding: FieldBinding;       // 默认颜色来源（binding 模式）；rules 无命中时可作兜底
  colorMode?: SpectrumColorMode; // 颜色模式
  customColor?: string;        // custom 模式颜色
  detectBinding?: FieldBinding; // rules 模式：要检测的字段（如 entity:type / entity:name）
  colorRules?: SpectrumColorRule[];
}
export interface SlotBlock extends BlockBase { type: 'slot'; slot: string; }              // 嵌套模板片段
export interface GroupBlock extends BlockBase { type: 'group'; direction: 'row' | 'col'; blocks: Block[]; }
export interface RepeatBlock extends BlockBase {
  type: 'repeat';
  source: { entityId: FieldBinding; relation?: string };
  itemTemplate: Block[];
}

export interface ShapeBlock extends BlockBase {
  type: 'shape';
  shape: 'rect' | 'circle' | 'ellipse' | 'triangle' | 'line' | 'star' | 'diamond';
  width?: number;
  height?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  borderRadius?: number; // 仅 rect
  rotation?: number;
}

export type ChartKind = 'bar' | 'line' | 'pie' | 'donut' | 'radar';
export const CHART_KIND_LABELS: Record<ChartKind, string> = {
  bar: '柱状图',
  line: '折线图',
  pie: '饼图',
  donut: '环形图',
  radar: '雷达图',
};
export interface ChartBlock extends BlockBase {
  type: 'chart';
  kind: ChartKind;
  binding?: FieldBinding; // 目标字段值应为 "label,value" 多行 CSV
  staticData?: string;    // 绑定为空时的静态数据
  width?: number;
  height?: number;
  color?: string;         // 主色，多系列可用逗号分隔
}

export interface FlowchartBlock extends BlockBase {
  type: 'flowchart';
  direction: 'row' | 'col';
  binding?: FieldBinding; // 字段值为逗号分隔的步骤名
  staticSteps?: string;   // 备用静态步骤，逗号分隔
  stepColor?: string;
  arrowColor?: string;
}

export interface QRCodeBlock extends BlockBase {
  type: 'qrcode';
  binding?: FieldBinding; // 字段值为二维码内容
  staticValue?: string;   // 静态内容
  size?: number;
  color?: string;
  bgColor?: string;
}

export type Block =
  | TextBlock | ImageBlock | TableBlock | DividerBlock | IconBlock
  | BarcodeBlock | SignatureBlock | SpectrumBlock | SlotBlock | GroupBlock | RepeatBlock
  | ShapeBlock | ChartBlock | FlowchartBlock | QRCodeBlock;

export type TemplateCategory = 'personnel' | 'identity' | 'daily' | 'intel' | 'technical' | 'narrative';

/** 分类中文显示（value 仍为英文 key，便于持久化与代码引用） */
export const CATEGORY_LABELS: Record<TemplateCategory, string> = {
  personnel: '人员',
  identity: '身份',
  daily: '日常',
  intel: '情报',
  technical: '技术',
  narrative: '叙事',
};

/** 模板自定义背景：可覆盖风格的纸张底色并叠加背景图 */
export interface TemplateBackground {
  color?: string;                    // 背景色（如 '#f5f3ec'）
  image?: string;                    // 背景图片（dataURL 或 URL）
  imageOpacity?: number;             // 0-1
  imageSize?: 'cover' | 'contain' | 'auto';
  imagePosition?: string;            // CSS background-position
  imageRepeat?: 'repeat' | 'no-repeat' | 'repeat-x' | 'repeat-y';
}

export interface MaterialTemplate {
  id: string;
  name: string;
  category: TemplateCategory;
  /** 适用风格：'*' 表示风格无关，引擎按通用字段渲染（用户决策 #6） */
  applicableStyles: '*' | string[];
  pageOverride?: PageKind;         // 覆盖风格版式
  background?: TemplateBackground; // 自定义背景（覆盖风格纸张底色）
  defaultUseAI?: boolean;          // 默认是否启用 AI 增强（UI 可改）
  description?: string;
  blocks: Block[];
}

/* ============================================================
 * 五、资产（AssetMeta）
 * 头像 / Logo / 纹理按归属归档并记引用计数，支撑跨图一致性。
 * ============================================================ */

export type AssetKind = 'portrait' | 'logo' | 'texture' | 'icon';
export type AssetOrigin = 'entity' | 'upload' | 'ai';

export interface AssetMeta {
  id: string;
  kind: AssetKind;
  ownerId?: string;               // portrait / logo 的归属实体
  src: string;                    // dataURL 或 inline svg
  origin: AssetOrigin;
  prompt?: string;                // ai 来源可追溯
  refCount: number;               // 引用计数
  createdAt: number;
}

/* ============================================================
 * 六、产出记录（GeneratedMaterial）
 * 每次渲染的结果快照，保证可复现与再导出。
 * ============================================================ */

export type MaterialStatus = 'draft' | 'rendered' | 'exported';

export interface GeneratedMaterial {
  id: string;
  templateId: string;
  styleId: string;
  entityId: string;               // 绑定主体（如 staffFile 的角色）
  bindings: Record<string, string>; // 实际渲染用字段快照
  assetIds: string[];             // 使用的资产 id
  useAI: boolean;
  status: MaterialStatus;
  output?: { png?: string; pdf?: string }; // dataURL / 文件路径
  createdAt: number;
  updatedAt: number;
}

/* ============================================================
 * 七、实体头像三模式（EntityPortrait）
 * 用户决策 #2：实体库插图 / 用户上传 / AI 生成 三种模式。
 * ============================================================ */

export type PortraitMode = 'entity' | 'upload' | 'ai';
export interface EntityPortrait {
  mode: PortraitMode;
  imageId?: string;   // mode='entity'：引用 WikiEntity.images 的 id
  uploadSrc?: string;  // mode='upload'：用户上传 dataURL
  aiSrc?: string;      // mode='ai'：AI 生成 dataURL
  prompt?: string;     // AI 生成 prompt（可追溯）
}

/* ============================================================
 * 八、默认工厂
 * 供 P0-3 风格编辑器与种子数据复用；不自动写入 WorldData。
 * ============================================================ */

export function createDefaultStyleToken(): StyleToken {
  return {
    palette: {
      paper: '#f5f3ec', ink: '#1a1a1a', accent: '#1f3a5f',
      muted: '#6b6b6b', danger: '#b00020', warn: '#c77700', barcode: '#222',
    },
    typography: {
      titleFont: '"Noto Serif SC", "Songti SC", serif',
      bodyFont: '"Noto Sans SC", "PingFang SC", sans-serif',
      monoFont: '"JetBrains Mono", "Courier New", monospace',
      titleSize: 22, bodySize: 13, labelSize: 11,
    },
    texture: { key: 'paper', opacity: 0.08, blend: 'multiply' },
    icon: { set: 'line', assets: [] },
    logo: { src: '', shape: 'circle', size: 56 },
    signature: { font: '"Caveat", cursive', color: '#1a1a1a', italic: true },
    layout: {
      page: 'A4', widthMm: 210, heightMm: 297, marginMm: 16, paddingMm: 12,
      header: '{worldName}', footer: 'CONFIDENTIAL', watermark: '',
    },
    tone: { register: 'formal', dictionary: [] },
  };
}
