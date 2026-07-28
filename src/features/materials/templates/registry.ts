// ============================================================
// 视觉物料生成器 · 内置模板注册表（P0-4）
// ------------------------------------------------------------
// 此处登记三个通用模板的「完整声明式 Block 组件树 + 字段绑定」。
// 引擎约定（由 P0-5 bindings.ts 解析）：
//   FieldBinding.source 七源：
//     entity      -> 实体结构化字段，path ∈ name|type|emoji|description|spectrumColor
//     customField -> 实体 materialFields 按 key 映射（用户决策 #3）；path='*' 仅用于 showIf 通配
//     world       -> 世界级，path='worldName'
//     style       -> 风格令牌，path='logo'（取 logo.src）|'accent' 等
//     image       -> 图片类，path='portrait'（按头像三模式取源，用户决策 #2）|'logo'
//     static      -> 固定文案，取 binding.static
//     relation    -> 关系数据（P2 接入）
//   TextBlock.content 支持插值 token：{field:path} / {world:path} / {style:path}
//     （二选一：有 binding 时优先 binding，否则按 content 插值）
//   TableBlock.rows：
//     'customFields' -> 遍历 materialFields，列绑定 path='__key__' 取键、'__value__' 取值
//     'entityFields' -> 遍历 entity.fields，列绑定 path='__label__'/'__value__'
//     'static'       -> 渲染 staticRows
//   无行时回退 staticRows（每个列取 cells[i]）。
//   showIf.notEmpty -> 该绑定值为空则隐藏整块（customField '*' 表示"存在任意字段"）。
// applicableStyles:'*' 表示与任意风格兼容（用户决策 #6）。
// ============================================================

import type { MaterialTemplate, FieldBinding } from '../types';

/* —— 常用绑定工厂，减少样板 —— */
const ent = (path: string): FieldBinding => ({ source: 'entity', path });
const cf = (path: string, fallback?: string): FieldBinding => ({ source: 'customField', path, fallback });
const img = (path: string): FieldBinding => ({ source: 'image', path });
const sty = (path: string): FieldBinding => ({ source: 'style', path });
const world = (path: string): FieldBinding => ({ source: 'world', path });

export const MATERIAL_TEMPLATES: MaterialTemplate[] = [
  /* ====================== ① 员工 / 角色档案 ====================== */
  {
    id: 'staffFile',
    name: '员工 / 角色档案',
    category: 'personnel',
    applicableStyles: '*',
    description: '机构人事档案：照片、签名、编号、健康 / 背景记录。',
    defaultUseAI: false,
    pageOverride: 'A4',
    blocks: [
      // 顶部：头像 + 基本信息
      {
        id: 'sf-head', type: 'group', direction: 'row',
        style: { gap: '14px', alignItems: 'flex-start' },
        blocks: [
          { id: 'sf-photo', type: 'image', binding: img('portrait'), placeholder: '照片', width: 108, height: 138, round: false },
          {
            id: 'sf-info', type: 'group', direction: 'col',
            style: { gap: '6px', flex: '1' },
            blocks: [
              { id: 'sf-name', type: 'text', role: 'title', content: '{field:name}' },
              { id: 'sf-type', type: 'text', role: 'body', content: '类别：{field:type}' },
              { id: 'sf-serial-l', type: 'text', role: 'label', content: '编号' },
              { id: 'sf-serial', type: 'barcode', binding: cf('serial', 'SUBJ-0000') },
            ],
          },
        ],
      },
      { id: 'sf-bio', type: 'text', role: 'body', content: '{customField:ai_bio}', showIf: { source: 'customField', path: 'ai_bio', notEmpty: true } },
      // P2-D：AI 生成字段（source:'ai'）。生成前为空 → 块隐藏；生成后写入 aiValues 显示。
      { id: 'sf-ai-quote', type: 'text', role: 'caption', content: '', binding: { source: 'ai', path: 'ai_quote', static: '一句世界观内台词 / 格言' } },
      { id: 'sf-div1', type: 'divider' },
      // 背景 / 健康记录表（通用 customFields）
      {
        id: 'sf-records', type: 'table',
        showIf: { source: 'customField', path: '*', notEmpty: true },
        columns: [
          { header: '项目', binding: cf('__key__') },
          { header: '记录', binding: cf('__value__') },
        ],
        rows: 'customFields',
        staticRows: [{ cells: ['（暂无附加记录）', ''] }],
      },
      { id: 'sf-div2', type: 'divider' },
      // 签名 + 光谱落款
      {
        id: 'sf-sign', type: 'group', direction: 'row',
        style: { justifyContent: 'space-between', alignItems: 'flex-end' },
        blocks: [
          { id: 'sf-sign-block', type: 'signature', binding: cf('signature', '（未签发）'), label: '签发人' },
          { id: 'sf-spectrum', type: 'spectrum', binding: ent('spectrumColor') },
        ],
      },
    ],
  },

  /* ====================== ② 证件 / ID 卡 ====================== */
  {
    id: 'idCard',
    name: '证件 / ID 卡',
    category: 'identity',
    applicableStyles: '*',
    description: '带条形码、签名、头像的实体身份卡。',
    defaultUseAI: false,
    pageOverride: 'id_card',
    blocks: [
      { id: 'id-org', type: 'text', role: 'title', content: '{world:worldName}' },
      { id: 'id-photo', type: 'image', binding: img('portrait'), placeholder: '头像', width: 96, height: 96, round: true },
      { id: 'id-name', type: 'text', role: 'value', content: '{field:name}' },
      { id: 'id-type', type: 'text', role: 'label', content: '类别：{field:type}' },
      { id: 'id-id-l', type: 'text', role: 'label', content: '证件号' },
      { id: 'id-barcode', type: 'barcode', binding: cf('id', 'ID-000000') },
      { id: 'id-sign', type: 'signature', binding: cf('signature', '（空白）'), label: '持证人签' },
      // P2-D：AI 生成标语 / 身份格言
      { id: 'id-ai-motto', type: 'text', role: 'label', content: '', binding: { source: 'ai', path: 'ai_motto', static: '一句身份格言 / 标语' } },
      { id: 'id-logo', type: 'image', binding: sty('logo'), placeholder: 'LOGO', width: 40, height: 40, round: false },
    ],
  },

  /* ====================== ③ 日常 / 菜单 ====================== */
  {
    id: 'menu',
    name: '日常 / 菜单',
    category: 'daily',
    applicableStyles: '*',
    description: '机构日常物料：菜单、通知、海报等。',
    defaultUseAI: false,
    pageOverride: 'A5',
    blocks: [
      { id: 'mn-title', type: 'text', role: 'title', content: '{field:name}' },
      { id: 'mn-sub', type: 'text', role: 'label', content: '{world:worldName}' },
      { id: 'mn-div1', type: 'divider' },
      {
        id: 'mn-items', type: 'table',
        showIf: { source: 'customField', path: '*', notEmpty: true },
        columns: [
          { header: '品项', binding: cf('__key__') },
          { header: '说明', binding: cf('__value__') },
        ],
        rows: 'customFields',
        staticRows: [{ cells: ['（暂无品项）', ''] }],
      },
      { id: 'mn-note', type: 'text', role: 'caption', content: '本物料依据机构当日供应生成。' },
      { id: 'mn-logo', type: 'image', binding: sty('logo'), placeholder: 'LOGO', width: 36, height: 36, round: false },
    ],
  },

  /* ====================== ④ 名册 / 关系名单 ====================== */
  {
    id: 'roster',
    name: '名册 / 关系名单',
    category: 'personnel',
    applicableStyles: '*',
    description: '按成员 ID 列表循环渲染的关系名单（在实体 materialFields 设 members=逗号分隔的实体 ID）。',
    defaultUseAI: false,
    pageOverride: 'A4',
    blocks: [
      { id: 'rs-title', type: 'text', role: 'title', content: '{field:name} · 成员名册' },
      { id: 'rs-sub', type: 'text', role: 'label', content: '{world:worldName}' },
      { id: 'rs-div', type: 'divider' },
      {
        id: 'rs-repeat', type: 'repeat',
        // source.entityId 解析出逗号分隔的实体 ID 串 → allEntities 查表 → 逐个渲染 itemTemplate
        source: { entityId: cf('members', '') },
        itemTemplate: [
          {
            id: 'rs-item', type: 'group', direction: 'row',
            style: { gap: '12px', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #00000022' },
            blocks: [
              { id: 'rs-photo', type: 'image', binding: img('portrait'), placeholder: '照片', width: 54, height: 68, round: false },
              {
                id: 'rs-info', type: 'group', direction: 'col',
                style: { gap: '3px', flex: '1' },
                blocks: [
                  { id: 'rs-name', type: 'text', role: 'value', content: '{field:name}' },
                  { id: 'rs-type', type: 'text', role: 'label', content: '类别：{field:type}' },
                  { id: 'rs-serial', type: 'barcode', binding: cf('serial', 'MEM-0000') },
                ],
              },
            ],
          },
        ],
      },
      { id: 'rs-empty', type: 'text', role: 'caption', content: '（在所选实体的 materialFields 写入 members=实体ID1,实体ID2… 即可列出成员）',
        showIf: { source: 'customField', path: 'members', notEmpty: false } },
    ],
  },
];

export const getTemplate = (
  id: string | null | undefined,
  userTemplates?: MaterialTemplate[],
): MaterialTemplate | undefined =>
  MATERIAL_TEMPLATES.find((t) => t.id === id) ??
  userTemplates?.find((t) => t.id === id);
