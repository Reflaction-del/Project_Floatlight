import { create } from 'zustand';
import { storage } from '../storage';
import { createDefaultStyleToken } from '../features/materials/types';
import type { MaterialStyle, GeneratedMaterial, MaterialTemplate } from '../features/materials/types';
import { GUIDE_DOCS } from '../seed/guide';
import type { Proposal, ChatSession } from './proposalTypes';
import type {
  DocFile,
  WikiElement,
  Timeline,
  TreeSelection,
  TimelineUnit,
  WikiEntity,
  WikiRelation,
  RelationType,
} from '../types';

/* 富文本种子内容（TipTap JSON） */
const seedDocContent = (title: string, body: string) => ({
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: title }] },
    ...(body ? [{ type: 'paragraph', content: [{ type: 'text', text: body }] }] : []),
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: '参见角色 ' },
        { type: 'wikiLink', attrs: { targetId: 'el-char-1', label: '林夜' } },
        { type: 'text', text: ' 与时间轴节点 ' },
        { type: 'wikiLink', attrs: { targetId: 'ev-1', label: '星陨之夜' } },
        { type: 'text', text: '。' },
      ],
    },
  ],
});

/* 一个世界的数据（独立于其他世界） */
export interface ClueBoardSettings {
  backgroundImage?: { id: string; dataUrl: string; name?: string };
  backgroundFit?: 'cover' | 'contain' | 'stretch' | 'tile' | 'center';
  backgroundScale?: number;
}

export interface WorldData {
  folders: string[];
  docs: DocFile[];
  timelines: Timeline[];
  /** 视觉物料生成器（P0）：用户创建的命名风格预设 */
  styles: MaterialStyle[];
  /** 视觉物料生成器（P0）：已渲染 / 导出的物料产出记录 */
  materials: GeneratedMaterial[];
  /** 视觉物料生成器（P3-C）：用户自定义模板（与内置 registry 互通，可编辑/导出/导入） */
  templates: MaterialTemplate[];
  /** M1 六类实体 */
  entities: WikiEntity[];
  /** M2 实体关系 */
  relations: WikiRelation[];
  /** 草稿箱（手动快记） */
  drafts: { id: string; title: string; content: string; createdAt: number }[];
  activeDocId: string;
  activeTimelineId: string;
  /** M6 线索板设置 */
  clueBoard: ClueBoardSettings;
  /** AI 提案队列（Phase 0）：所有 AI 产出先入队，用户逐条采纳/拒绝 */
  proposals: Proposal[];
  /** AI 对话记录（Phase 0）：每世界一份持久化会话 */
  chats: ChatSession[];
  /** 演示种子版本号（仅演示世界带此字段）；< CURRENT_SEED_VERSION 时启动时强制升级到最新演示 */
  seedVersion?: number;
}

interface WorldState {
  current: string;
  worldsData: Record<string, WorldData>;
  /** 当前世界是否有未保存修改（仅 UI 提示用） */
  dirty: boolean;
  /** 文件树当前选中项（右键菜单删除用） */
  selectedTree: TreeSelection | null;
  /* ——— 工具集 ——— */
  getDoc: (id: string) => DocFile | undefined;
  updateDocContent: (id: string, content: unknown) => void;
  setActiveDoc: (id: string) => void;
  setActiveTimeline: (id: string) => void;
  addTimeline: (name: string) => void;
  addTimelineEvent: (timelineId: string, ev: Omit<Timeline['events'][number], 'id'>, opts?: { autoEntity?: boolean }) => string;
  updateTimelineEvent: (timelineId: string, eventId: string, patch: Partial<Timeline['events'][number]>) => void;
  deleteTimelineEvent: (timelineId: string, eventId: string) => void;
  setTimelineUnit: (id: string, unit: TimelineUnit, unitLabel?: string) => void;
  /* ——— 文件管理 ——— */
  setSelectedTree: (sel: TreeSelection | null) => void;
  addDoc: (title: string, folder: string) => void;
  addFolder: (name: string) => void;
  deleteDoc: (id: string) => void;
  deleteFolder: (name: string) => void;
  deleteTimeline: (id: string) => void;
  renameDoc: (id: string, title: string) => void;
  renameTimeline: (id: string, name: string) => void;
  updateDocIcon: (id: string, icon: string) => void;
  /* ——— 跨文件夹移动 ——— */
  moveDocToFolder: (id: string, folder: string) => void;
  /* ——— M1 实体 ——— */
  addEntity: (e: { type: WikiEntity['type']; name: string; fields?: WikiEntity['fields']; custom?: WikiEntity['custom']; tags?: WikiEntity['tags']; note?: string; images?: WikiEntity['images']; coverImageId?: string; materialFields?: WikiEntity['materialFields']; portrait?: WikiEntity['portrait']; spectrumColor?: string; id?: string }) => string;
  updateEntity: (id: string, patch: Partial<WikiEntity>) => void;
  deleteEntity: (id: string) => void;
  addEntityImage: (entityId: string, dataUrl: string, name?: string) => void;
  removeEntityImage: (entityId: string, imageId: string) => void;
  setEntityCoverImage: (entityId: string, imageId: string | undefined) => void;
  /* ——— M7-3 实体评论 / 版本 ——— */
  addEntityComment: (entityId: string, author: string, content: string) => void;
  saveEntityVersion: (entityId: string) => void;
  restoreEntityVersion: (entityId: string, version: number) => void;
  /* ——— M7 合并导入（冲突解决后落库） ——— */
  mergeImported: (entities: WikiEntity[], relations: WikiRelation[]) => void;
  /* ——— M2 关系 ——— */
  addRelation: (source: string, target: string, type: RelationType, label?: string) => void;
  updateRelation: (id: string, patch: Partial<WikiRelation>) => void;
  removeRelation: (id: string) => void;
  clearRelations: () => void;
  /* ——— M6 线索板 ——— */
  setClueBoardBackground: (image: { id: string; dataUrl: string; name?: string }) => void;
  removeClueBoardBackground: () => void;
  setClueBoardBackgroundFit: (fit: ClueBoardSettings['backgroundFit']) => void;
  setClueBoardBackgroundScale: (scale: number) => void;
  /* ——— 草稿箱 ——— */
  addDraft: (title: string, content: string) => void;
  updateDraft: (id: string, title: string, content: string) => void;
  deleteDraft: (id: string) => void;
  /* ——— 世界管理 ——— */
  /* —— 视觉物料生成器（P0-1d） —— */
  addStyle: (input: Omit<MaterialStyle, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateStyle: (id: string, patch: Partial<MaterialStyle>) => void;
  deleteStyle: (id: string) => void;
  addMaterial: (input: Omit<GeneratedMaterial, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateMaterial: (id: string, patch: Partial<GeneratedMaterial>) => void;
  deleteMaterial: (id: string) => void;
  /* —— 视觉物料生成器（P3-C）：用户自定义模板 —— */
  addTemplate: (tpl: MaterialTemplate) => string;
  updateTemplate: (id: string, patch: Partial<MaterialTemplate>) => void;
  deleteTemplate: (id: string) => void;
  addWorld: (name: string, template?: 'empty' | 'novel' | 'script') => void;
  removeWorld: (name: string, nextName?: string) => void;
  renameWorld: (oldName: string, newName: string) => void;
  switchWorld: (name: string, onPrompt?: (current: string) => Promise<'save' | 'discard' | 'cancel'>) => Promise<boolean>;
  markDirty: () => void;
  markClean: () => void;
  /** 手动保存当前世界全部数据（刷盘） */
  saveNow: () => void;
  /* ——— AI 提案队列（Phase 0） ——— */
  addProposal: (input: Omit<Proposal, 'id' | 'status' | 'createdAt'>) => string;
  acceptProposal: (id: string) => void;
  rejectProposal: (id: string) => void;
  acceptAllProposals: () => void;
  clearResolvedProposals: () => void;
  /* ——— AI 对话持久化（Phase 0） ——— */
  upsertChat: (worldKey: string, chat: ChatSession) => void;
  getChat: (worldKey: string, id: string) => ChatSession | undefined;
  deleteChat: (worldKey: string, id: string) => void;
}

/* —— 模板 —— */
function emptyTemplate(): WorldData {
  return {
    folders: ['未分组'],
    docs: [],
    timelines: [],
    styles: [],
    materials: [],
    templates: [],
    entities: [],
    relations: [],
    drafts: [],
    activeDocId: '',
    activeTimelineId: '',
    clueBoard: {},
    proposals: [],
    chats: [],
  };
}
function novelTemplate(): WorldData {
  return {
    folders: ['角色', '场景', '章节'],
    docs: [
      { id: 'novel-doc-1', title: '主角设定', icon: '', folder: '角色', content: seedDocContent('主角设定', '世界观的女/男主角——性格、背景、动机。') },
      { id: 'novel-doc-2', title: '世界观概览', icon: '', folder: '场景', content: seedDocContent('世界观概览', '时代背景、地理设定、核心冲突。') },
      { id: 'novel-doc-3', title: '序章', icon: '', folder: '章节', content: seedDocContent('序章', '故事开场。') },
    ],
    timelines: [{
      id: 'novel-tl-1', name: '主线时间', unit: 'year',
      events: [
        { id: 'novel-ev-1', label: '故事开始', year: 0, color: '#3b82f6' },
        { id: 'novel-ev-2', label: '关键转折', year: 12, color: '#ef4444' },
      ],
    }],
    styles: [],
    materials: [],
    templates: [],
    entities: [],
    relations: [],
    drafts: [],
    activeDocId: 'novel-doc-1',
    activeTimelineId: 'novel-tl-1',
    clueBoard: {},
    proposals: [],
    chats: [],
  };
}
function scriptTemplate(): WorldData {
  return {
    folders: ['角色', '场次'],
    docs: [
      { id: 'script-doc-1', title: '人物小传', icon: '', folder: '角色', content: seedDocContent('人物小传', '剧本角色详细描述。') },
      { id: 'script-doc-2', title: '第一幕', icon: '', folder: '场次', content: seedDocContent('第一幕', '开篇场景。') },
    ],
    timelines: [{ id: 'script-tl-1', name: '剧本时间', unit: 'year', events: [{ id: 'script-ev-1', label: '开场', year: 0, color: '#8b5cf6' }] }],
    styles: [],
    materials: [],
    templates: [],
    entities: [],
    relations: [],
    drafts: [],
    activeDocId: 'script-doc-1',
    activeTimelineId: 'script-tl-1',
    clueBoard: {},
    proposals: [],
    chats: [],
  };
}

const TEMPLATES = { empty: emptyTemplate, novel: novelTemplate, script: scriptTemplate } as const;

/* —— 旧版数据迁移：timeline 类型实体 -> 时间轴事件 —— */
function migrateTimelineEntities(data: Record<string, WorldData>): Record<string, WorldData> {
  let changed = false;
  const next: Record<string, WorldData> = {};
  for (const [name, wd] of Object.entries(data)) {
    if (!wd) { next[name] = wd; continue; }
    const timelineEntities = wd.entities.filter((e) => (e as any).type === 'timeline');
    if (timelineEntities.length === 0) { next[name] = wd; continue; }
    changed = true;
    const removedIds = new Set(timelineEntities.map((e) => e.id));
    const entities = wd.entities.filter((e) => !removedIds.has(e.id));
    const relations = wd.relations.filter((r) => !removedIds.has(r.source) && !removedIds.has(r.target));
    // 将 timeline 实体转换为当前时间轴上的事件
    const targetTl = wd.timelines.find((t) => t.id === wd.activeTimelineId) ?? wd.timelines[0];
    const addedEvents: Timeline['events'] = [];
    for (const ent of timelineEntities) {
      const yearField = ent.fields.find((f) => f.label === '年份')?.value || ent.custom.find((c) => c.label === '年份')?.value || '';
      const year = Number(yearField);
      const impactField = ent.fields.find((f) => f.label === '影响')?.value || ent.custom.find((c) => c.label === '影响')?.value || '';
      const impact = Math.max(0, Math.min(100, Number(impactField) || 50));
      if (Number.isFinite(year) && yearField.trim() !== '') {
        addedEvents.push({ id: `ev-${evSeq++}`, label: ent.name, year, impact, note: ent.note, color: '#8b5cf6' });
      }
    }
    const timelines = wd.timelines.map((t) => {
      if (targetTl && t.id === targetTl.id && addedEvents.length) {
        return { ...t, events: [...t.events, ...addedEvents] };
      }
      return { ...t, events: t.events.map((e) => (e.entityId && removedIds.has(e.entityId) ? { ...e, entityId: undefined } : e)) };
    });
    next[name] = { ...wd, entities, relations, timelines };
  }
  if (changed) saveAllData(next);
  return next;
}

/* —— localStorage 持久化 —— */
const LS_DATA_KEY = 'fl-worlds-data';
const LS_CURRENT = 'fl-current-world';

function loadAllData(): Record<string, WorldData> {
  // 桌面版：数据由 main.tsx 启动期从磁盘注入，不读取 localStorage，避免删磁盘文件后从 localStorage 复活
  if (storage.isNative()) return {};
  try {
    const raw = localStorage.getItem(LS_DATA_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch { /* ignore */ }
  return {};
}

function saveAllData(data: Record<string, WorldData>) {
  storage.saveWorldsData(data);
}

/* —— 默认世界（首次启动时初始化） —— */
export const DEFAULT_WORLD = '幻光纪元';
/* 为种子实体自动补上版本快照（v1），与运行期 addEntity 行为一致 */
const mkVer = (e: WikiEntity): WikiEntity => ({
  ...e,
  versions: [{
    version: 1, ts: 0,
    snapshot: {
      name: e.name, type: e.type,
      fields: e.fields, custom: e.custom, tags: e.tags, note: e.note,
      images: e.images, coverImageId: e.coverImageId,
    },
  }],
});

/* 旧版演示工程的特征实体集合，用于“自动升级”为新演示工程 */
const OLD_DEMO_ENTITY_IDS = ['en-char-1', 'en-fac-1', 'en-loc-1', 'en-evt-1', 'en-rule-1'];
export function isOldDemo(wd: WorldData | undefined): boolean {
  if (!wd) return false;
  const ids = (wd.entities || []).map((e) => e.id).sort();
  if (ids.length !== OLD_DEMO_ENTITY_IDS.length) return false;
  return ids.every((id) => OLD_DEMO_ENTITY_IDS.includes(id));
}

/* 当前演示种子版本号；每次重做演示项目时 +1，旧版本在启动时被强制刷新 */
export const CURRENT_SEED_VERSION = 2;

/**
 * 判断某个世界是否为「已知的演示种子」（而非用户真实数据）。
 * 指纹：同时具备演示引导文档与新手指引风格——这两者在用户正常创作时不会出现。
 */
export function isKnownDemoSeed(wd: WorldData | undefined): boolean {
  if (!wd) return false;
  const hasGuide = (wd.docs ?? []).some((d) => d.id === 'guide-manual');
  const hasStyle = (wd.styles ?? []).some((s) => s.id === 'ms-demo-leylight');
  return hasGuide && hasStyle;
}

/**
 * 综合判断：该世界是否需要在启动时强制升级为最新演示种子。
 * 覆盖三种情况：① 完全空白的示例工程 ② 旧版演示工程 ③ 已知演示种子但 seedVersion 落后。
 * 注意：仅对「已知演示种子」做版本比对，绝不会触碰用户自建世界。
 */
export function needsSeedUpgrade(wd: WorldData | undefined): boolean {
  if (isDefaultWorldEmpty(wd)) return true;
  if (isOldDemo(wd)) return true;
  if (isKnownDemoSeed(wd) && (wd?.seedVersion ?? 0) < CURRENT_SEED_VERSION) return true;
  return false;
}

/**
 * 判断“默认世界”是否为【空】示例工程、可被安全升级覆盖。
 * 必须“实体 / 关系 / 草稿 / 文档 / 卡片 / 时间轴”全部为空才算空，
 * 否则视为用户真实数据，绝不自动覆盖。
 * 修复 P0-1.1：原逻辑只看 entities/relations/drafts，导致“只写了文档还没建实体”
 * 的新用户下次启动被静默覆盖回演示种子。
 */
export function isDefaultWorldEmpty(wd: WorldData | undefined): boolean {
  if (!wd) return true;
  return (
    (wd.entities?.length ?? 0) === 0 &&
    (wd.relations?.length ?? 0) === 0 &&
    (wd.drafts?.length ?? 0) === 0 &&
    (wd.docs?.length ?? 0) === 0 &&
    (wd.timelines?.length ?? 0) === 0
  );
}

/* —— 演示风格 / 模板 / 提案：让默认世界开箱即展示 MaterialForge 与提案中心 —— */
const DEMO_STYLE: MaterialStyle = {
  id: 'ms-demo-leylight',
  name: '灵脉 · 青蓝',
  tags: ['奇幻', '灵脉', '演示'],
  description: '演示风格：以灵脉青蓝为主色的浮空城邦质感。',
  builtin: false,
  token: (() => {
    const t = createDefaultStyleToken();
    t.palette = { ...t.palette, paper: '#eef4f6', ink: '#16323b', accent: '#1f6f8b', muted: '#5b7a82', barcode: '#1f6f8b' };
    t.typography = { ...t.typography, titleFont: '"Noto Serif SC", "Songti SC", serif', titleSize: 24 };
    t.layout = { ...t.layout, page: 'A4', header: '{worldName} · 灵脉档案', footer: 'CONFIDENTIAL · 幻光纪元', watermark: '幻光纪元' };
    t.signature = { ...t.signature, color: '#1f6f8b' };
    return t;
  })(),
  createdAt: 0,
  updatedAt: 0,
};

const DEMO_TEMPLATE: MaterialTemplate = {
  id: 'mt-demo-character',
  name: '角色卡 · 灵脉',
  category: 'personnel',
  applicableStyles: ['*'],
  defaultUseAI: false,
  description: '演示模板：角色身份卡，含头像、身份、动机与可见光条。',
  blocks: [
    { id: 'b-title', type: 'text', content: '{entity:name}', role: 'title' },
    { id: 'b-img', type: 'image', binding: { source: 'image', path: 'portrait' }, round: true, width: 120, height: 120 },
    { id: 'b-id', type: 'text', content: '{entity:身份}', role: 'label', binding: { source: 'entity', path: '身份', fallback: '身份未填' } },
    { id: 'b-mot', type: 'text', content: '{entity:动机}', role: 'body', binding: { source: 'entity', path: '动机', fallback: '动机未填' } },
    { id: 'b-div', type: 'divider' },
    { id: 'b-spec', type: 'spectrum', binding: { source: 'entity', path: 'type' }, colorMode: 'custom', customColor: '#1f6f8b' },
  ] as any,
};

const DEMO_PROPOSAL: Proposal = {
  id: 'pp-demo-1',
  source: 'manual',
  createdAt: 0,
  status: 'pending',
  summary: '示例提案：新增角色「（示例）观星人」',
  op: {
    kind: 'addEntity',
    entity: {
      type: 'character',
      name: '（示例）观星人',
      fields: [
        { label: '身份', value: '星象观测者' },
        { label: '阵营', value: '' },
        { label: '年龄', value: '?' },
        { label: '外貌', value: '' },
        { label: '性格', value: '沉默' },
        { label: '动机', value: '记录灵脉的每一次回响' },
        { label: '经历', value: '' },
      ],
      custom: [],
      tags: ['示例', '演示'],
      note: '这是一条演示用提案。可在「提案中心」点「采纳」加进实体库，或「拒绝」丢弃。',
    },
  },
};

export const DEFAULT_DATA: WorldData = {
  seedVersion: CURRENT_SEED_VERSION,
  folders: ['新手引导', '序章', '角色志', '地理志', '势力志', '规则志', '编年史', '外传'],
  docs: [...GUIDE_DOCS,
    {
      id: 'doc-1', title: '第一章 · 创世', icon: '', folder: '序章',
      content: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '第一章 · 创世' }] },
          { type: 'paragraph', content: [{ type: 'text', text: '世界诞生于一次静默的裂变，灵脉自此流淌于天地之间。' }] },
          { type: 'paragraph', content: [
            { type: 'text', text: '主角 ' },
            { type: 'wikiLink', attrs: { targetId: 'en-char-1', label: '林夜' } },
            { type: 'text', text: ' 隶属秘密结社 ' },
            { type: 'wikiLink', attrs: { targetId: 'en-fac-1', label: '守夜人' } },
            { type: 'text', text: '，与失忆少女 ' },
            { type: 'wikiLink', attrs: { targetId: 'en-char-2', label: '苏泠' } },
            { type: 'text', text: ' 一同踏上旅途。' },
          ] },
          { type: 'paragraph', content: [
            { type: 'text', text: '一切始于时间轴上的 ' },
            { type: 'wikiLink', attrs: { targetId: 'ev-1', label: '星陨之夜' } },
            { type: 'text', text: '。' },
          ] },
        ],
      },
    },
    {
      id: 'doc-2', title: '角色设定 · 林夜', icon: '', folder: '角色志',
      content: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '角色设定 · 林夜' }] },
          { type: 'paragraph', content: [{ type: 'text', text: '守夜人最后的学徒，在星陨之夜后踏上寻找真相之路。' }] },
          { type: 'paragraph', content: [
            { type: 'text', text: '隶属 ' },
            { type: 'wikiLink', attrs: { targetId: 'en-fac-1', label: '守夜人' } },
            { type: 'text', text: '，出自浮空城邦 ' },
            { type: 'wikiLink', attrs: { targetId: 'en-loc-1', label: '云隐城' } },
            { type: 'text', text: '，同伴是 ' },
            { type: 'wikiLink', attrs: { targetId: 'en-char-2', label: '苏泠' } },
            { type: 'text', text: '。' },
          ] },
        ],
      },
    },
    {
      id: 'doc-11', title: '角色设定 · 苏泠', icon: '', folder: '角色志',
      content: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '角色设定 · 苏泠' }] },
          { type: 'paragraph', content: [{ type: 'text', text: '自海中而来的失忆少女，灵脉感应在她体内悄然觉醒。' }] },
          { type: 'paragraph', content: [
            { type: 'text', text: '被 ' },
            { type: 'wikiLink', attrs: { targetId: 'en-fac-1', label: '守夜人' } },
            { type: 'text', text: ' 收留，与 ' },
            { type: 'wikiLink', attrs: { targetId: 'en-char-1', label: '林夜' } },
            { type: 'text', text: ' 结伴；其身世牵系 ' },
            { type: 'wikiLink', attrs: { targetId: 'en-char-3', label: '玄' } },
            { type: 'text', text: ' 与宿敌 ' },
            { type: 'wikiLink', attrs: { targetId: 'en-fac-2', label: '黯蚀教团' } },
            { type: 'text', text: '。' },
          ] },
        ],
      },
    },
    {
      id: 'doc-12', title: '角色设定 · 玄', icon: '', folder: '角色志',
      content: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '角色设定 · 玄' }] },
          { type: 'paragraph', content: [{ type: 'text', text: '守夜人的脊梁，星陨之夜后立下守护之誓。' }] },
          { type: 'paragraph', content: [
            { type: 'text', text: '与 ' },
            { type: 'wikiLink', attrs: { targetId: 'en-char-4', label: '蚀' } },
            { type: 'text', text: ' 本是同门，如今分道扬镳；执掌 ' },
            { type: 'wikiLink', attrs: { targetId: 'en-fac-1', label: '守夜人' } },
            { type: 'text', text: '，对抗 ' },
            { type: 'wikiLink', attrs: { targetId: 'en-fac-2', label: '黯蚀教团' } },
            { type: 'text', text: '。' },
          ] },
        ],
      },
    },
    {
      id: 'doc-3', title: '地图考据 · 云隐城', icon: '', folder: '地理志',
      content: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '地图考据 · 云隐城' }] },
          { type: 'paragraph', content: [{ type: 'text', text: '悬浮于灵脉之上的城邦，守夜人的最后据点。' }] },
          { type: 'paragraph', content: [
            { type: 'text', text: '详见时间轴节点 ' },
            { type: 'wikiLink', attrs: { targetId: 'ev-2', label: '云隐城升空' } },
            { type: 'text', text: '，由 ' },
            { type: 'wikiLink', attrs: { targetId: 'en-fac-3', label: '云隐城议会' } },
            { type: 'text', text: ' 治理。' },
          ] },
        ],
      },
    },
    {
      id: 'doc-13', title: '地图考据 · 幽潮深渊', icon: '', folder: '地理志',
      content: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '地图考据 · 幽潮深渊' }] },
          { type: 'paragraph', content: [{ type: 'text', text: '灵脉枯竭后裂开的深渊，黯蚀教团的圣地。' }] },
          { type: 'paragraph', content: [
            { type: 'text', text: '源于 ' },
            { type: 'wikiLink', attrs: { targetId: 'en-evt-3', label: '灵脉枯竭' } },
            { type: 'text', text: '，现为 ' },
            { type: 'wikiLink', attrs: { targetId: 'en-fac-2', label: '黯蚀教团' } },
            { type: 'text', text: ' 盘踞之地。' },
          ] },
        ],
      },
    },
    {
      id: 'doc-4', title: '势力志 · 守夜人', icon: '', folder: '势力志',
      content: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '势力志 · 守夜人' }] },
          { type: 'paragraph', content: [{ type: 'text', text: '守护残余灵脉的秘密结社，立誓于灵脉枯竭之时。' }] },
          { type: 'paragraph', content: [
            { type: 'text', text: '其根基是 ' },
            { type: 'wikiLink', attrs: { targetId: 'en-rule-1', label: '灵脉法则' } },
            { type: 'text', text: '，受 ' },
            { type: 'wikiLink', attrs: { targetId: 'en-rule-2', label: '守夜契约' } },
            { type: 'text', text: ' 约束。' },
          ] },
        ],
      },
    },
    {
      id: 'doc-14', title: '势力志 · 黯蚀教团', icon: '', folder: '势力志',
      content: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '势力志 · 黯蚀教团' }] },
          { type: 'paragraph', content: [{ type: 'text', text: '崇拜灵脉枯竭的狂热教团，视吞噬灵脉为“净化”。' }] },
          { type: 'paragraph', content: [
            { type: 'text', text: '由 ' },
            { type: 'wikiLink', attrs: { targetId: 'en-char-4', label: '蚀' } },
            { type: 'text', text: ' 执掌，兴起于 ' },
            { type: 'wikiLink', attrs: { targetId: 'en-evt-3', label: '灵脉枯竭' } },
            { type: 'text', text: ' 之后。' },
          ] },
        ],
      },
    },
    {
      id: 'doc-5', title: '世界法则 · 灵脉', icon: '', folder: '规则志',
      content: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '世界法则 · 灵脉' }] },
          { type: 'paragraph', content: [{ type: 'text', text: '灵脉是世界本源能量，枯竭后将由守夜人维系。' }] },
          { type: 'paragraph', content: [
            { type: 'text', text: '详见 ' },
            { type: 'wikiLink', attrs: { targetId: 'en-rule-1', label: '灵脉法则' } },
            { type: 'text', text: '，守护者为 ' },
            { type: 'wikiLink', attrs: { targetId: 'en-fac-1', label: '守夜人' } },
            { type: 'text', text: '。' },
          ] },
        ],
      },
    },
    {
      id: 'doc-15', title: '编年史 · 灵脉纪元', icon: '', folder: '编年史',
      content: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '编年史 · 灵脉纪元' }] },
          { type: 'paragraph', content: [{ type: 'text', text: '从星陨到回响，灵脉纪元的兴衰一览。' }] },
          { type: 'paragraph', content: [
            { type: 'text', text: '始于 ' },
            { type: 'wikiLink', attrs: { targetId: 'ev-1', label: '星陨之夜' } },
            { type: 'text', text: '，危于 ' },
            { type: 'wikiLink', attrs: { targetId: 'en-evt-3', label: '灵脉枯竭' } },
            { type: 'text', text: '，立誓于 ' },
            { type: 'wikiLink', attrs: { targetId: 'ev-4', label: '守夜人誓约' } },
            { type: 'text', text: '，终现 ' },
            { type: 'wikiLink', attrs: { targetId: 'en-evt-5', label: '黯蚀之忧' } },
            { type: 'text', text: '。' },
          ] },
        ],
      },
    },
    {
      id: 'doc-16', title: '外传 · 深渊回响', icon: '', folder: '外传',
      content: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '外传 · 深渊回响' }] },
          { type: 'paragraph', content: [{ type: 'text', text: '深渊之下，回响不绝。一段关于记忆与救赎的外传。' }] },
          { type: 'paragraph', content: [
            { type: 'text', text: '少女 ' },
            { type: 'wikiLink', attrs: { targetId: 'en-char-2', label: '苏泠' } },
            { type: 'text', text: ' 循着灵脉走入 ' },
            { type: 'wikiLink', attrs: { targetId: 'en-loc-3', label: '幽潮深渊' } },
            { type: 'text', text: '，遇见了 ' },
            { type: 'wikiLink', attrs: { targetId: 'en-char-3', label: '玄' } },
            { type: 'text', text: ' 不愿提起的过去。' },
          ] },
        ],
      },
    },
  ],
  timelines: [
    {
      id: 'tl-main', name: '主线时间轴', unit: 'year',
      events: [
        { id: 'ev-1', label: '星陨之夜', year: 0, note: '天外陨星坠落，灵脉首次显现。', color: '#ef4444', impact: 95, entityId: 'en-evt-1' },
        { id: 'ev-5', label: '灵脉首次显现', year: 0, note: '陨星落地后，灵脉如蛛网般在大地蔓延。', color: '#f97316', impact: 80, entityId: 'en-evt-1' },
        { id: 'ev-6', label: '林夜成为学徒', year: 8, note: '林夜在废墟中被守夜人发现并收为学徒。', color: '#10b981', impact: 60, entityId: 'en-char-1' },
        { id: 'ev-2', label: '云隐城升空', year: 12, note: '城邦借灵脉之力悬浮于云端。', color: '#3b82f6', impact: 70, entityId: 'en-evt-2' },
        { id: 'ev-3', label: '灵脉枯竭', year: 30, note: '灵脉能量衰减，深渊显现。', color: '#f59e0b', impact: 80, entityId: 'en-evt-3' },
        { id: 'ev-4', label: '守夜人誓约', year: 41, note: '守夜人立誓守护残余灵脉。', color: '#16a34a', impact: 75, entityId: 'en-evt-4' },
        { id: 'ev-7', label: '苏泠觉醒', year: 45, note: '苏泠在海岸苏醒，灵脉感应觉醒。', color: '#a855f7', impact: 72, entityId: 'en-char-2' },
        { id: 'ev-10', label: '黯蚀之忧', year: 52, note: '黯蚀教团借深渊灵脉崛起。', color: '#dc2626', impact: 85, entityId: 'en-evt-5' },
        { id: 'ev-8', label: '双生决裂', year: 55, note: '玄与蚀于深渊之畔彻底决裂。', color: '#7c3aed', impact: 90, entityId: 'en-char-3' },
        { id: 'ev-9', label: '灵脉回响', year: 60, note: '灵脉于守夜人誓约百年后重新回响。', color: '#06b6d4', impact: 88, entityId: 'en-rule-1' },
      ],
    },
    {
      id: 'tl-leylines', name: '灵脉纪元史', unit: 'custom', unitLabel: '纪元',
      events: [
        { id: 'evl-1', label: '灵脉初生', year: -200, note: '灵脉自地心萌发，滋养万物。', color: '#22d3ee', impact: 70 },
        { id: 'evl-2', label: '星陨引脉', year: 0, note: '陨星凿开灵脉之眼，灵脉涌入人间。', color: '#ef4444', impact: 95, entityId: 'en-evt-1' },
        { id: 'evl-3', label: '灵脉鼎盛', year: 20, note: '灵脉遍布大陆，文明繁荣。', color: '#10b981', impact: 90 },
        { id: 'evl-4', label: '灵脉枯竭', year: 30, note: '灵脉骤然衰减，深渊显现。', color: '#f59e0b', impact: 80, entityId: 'en-evt-3' },
        { id: 'evl-5', label: '灵脉回响', year: 60, note: '守夜人誓约百年后，灵脉重新回响。', color: '#06b6d4', impact: 88, entityId: 'en-rule-1' },
      ],
    },
    {
      id: 'tl-characters', name: '角色编年', unit: 'year',
      events: [
        { id: 'evc-1', label: '林夜诞生', year: -3, note: '林夜生于灵脉将枯之年。', color: '#10b981', impact: 50, entityId: 'en-char-1' },
        { id: 'evc-3', label: '玄继任大守夜', year: 38, note: '玄接掌守夜人，立誓守护。', color: '#16a34a', impact: 70, entityId: 'en-char-3' },
        { id: 'evc-4', label: '蚀堕入黯蚀', year: 50, note: '蚀脱离守夜人，建立黯蚀教团。', color: '#dc2626', impact: 85, entityId: 'en-char-4' },
        { id: 'evc-5', label: '林夜苏泠结盟', year: 47, note: '二人于云隐城立下生死之约。', color: '#8b5cf6', impact: 60, entityId: 'en-char-1' },
        { id: 'evc-2', label: '苏泠流落', year: 43, note: '苏泠被海潮冲上云隐海岸。', color: '#a855f7', impact: 55, entityId: 'en-char-2' },
      ],
    },
  ],
  styles: [DEMO_STYLE],
  materials: [],
  templates: [DEMO_TEMPLATE],
  activeDocId: 'guide-welcome',
  activeTimelineId: 'tl-main',
  clueBoard: {},
  entities: [
    mkVer({ id: 'en-char-1', type: 'character', name: '林夜',
      fields: [
        { label: '身份', value: '守夜人学徒' },
        { label: '阵营', value: 'en-fac-1', kind: 'entity', entityType: ['faction', 'location'] },
        { label: '年龄', value: '19' },
        { label: '外貌', value: '黑发灰瞳，左腕烙有灵脉印记' },
        { label: '性格', value: '沉默执拗' },
        { label: '动机', value: '寻找星陨之夜的真相' },
        { label: '经历', value: '废墟中被守夜人收留' },
      ],
      custom: [{ label: '灵脉天赋', value: '极高' }],
      tags: ['守夜人', '主角'],
      note: '沉默而执拗的少年，天生的灵脉感应者，是这个故事的眼睛。',
      comments: [{ id: 'c-1', author: '作者', content: '考虑给林夜加一段“失忆”前史，让身世与苏泠呼应。', ts: 0 }],
      createdAt: 0, updatedAt: 0 }),
    mkVer({ id: 'en-char-2', type: 'character', name: '苏泠',
      fields: [
        { label: '身份', value: '失忆少女' },
        { label: '阵营', value: 'en-fac-1', kind: 'entity', entityType: ['faction', 'location'] },
        { label: '年龄', value: '17' },
        { label: '外貌', value: '银发，瞳孔泛着幽蓝' },
        { label: '性格', value: '温柔而疏离' },
        { label: '动机', value: '找回自己的过去' },
        { label: '经历', value: '被海潮冲上云隐城海岸' },
      ],
      custom: [{ label: '灵脉感应', value: '觉醒中' }],
      tags: ['守夜人', '谜'],
      note: '自海中而来的少女，记忆破碎，却与灵脉深处有着奇异的共鸣。',
      comments: [{ id: 'c-2', author: '作者', content: '苏泠的身世与玄有关，建议第三幕揭晓。', ts: 0 }],
      createdAt: 0, updatedAt: 0 }),
    mkVer({ id: 'en-char-3', type: 'character', name: '玄',
      fields: [
        { label: '身份', value: '大守夜（守夜人领袖）' },
        { label: '阵营', value: 'en-fac-1', kind: 'entity', entityType: ['faction', 'location'] },
        { label: '年龄', value: '58' },
        { label: '外貌', value: '白发，面容肃穆' },
        { label: '性格', value: '坚毅隐忍' },
        { label: '动机', value: '维系残余灵脉' },
        { label: '经历', value: '继任大守夜三十载' },
      ],
      custom: [{ label: '师承', value: '初代大守夜' }],
      tags: ['守夜人', '领袖'],
      note: '守夜人的脊梁，曾在星陨之夜后立下誓约。',
      comments: [],
      createdAt: 0, updatedAt: 0 }),
    mkVer({ id: 'en-char-4', type: 'character', name: '蚀',
      fields: [
        { label: '身份', value: '黯蚀教团之主' },
        { label: '阵营', value: 'en-fac-2', kind: 'entity', entityType: ['faction', 'location'] },
        { label: '年龄', value: '57' },
        { label: '外貌', value: '黑袍，半面陨痕' },
        { label: '性格', value: '偏执狂热' },
        { label: '动机', value: '吞噬灵脉以重塑世界' },
        { label: '经历', value: '与玄同门，后堕入黯蚀' },
      ],
      custom: [{ label: '旧名', value: '玄之师弟' }],
      tags: ['黯蚀教团', '反派'],
      note: '守夜人曾经的希望，如今是灵脉最大的威胁。',
      comments: [],
      createdAt: 0, updatedAt: 0 }),
    mkVer({ id: 'en-fac-1', type: 'faction', name: '守夜人',
      fields: [
        { label: '性质', value: '守护组织' },
        { label: '领袖', value: 'en-char-3', kind: 'entity', entityType: ['character'] },
        { label: '据点', value: '云隐城' },
        { label: '信条', value: '守护残余灵脉' },
        { label: '势力范围', value: '云隐城及灵脉节点' },
      ],
      custom: [{ label: '人数', value: '约三百' }],
      tags: ['守夜人'],
      note: '隐秘结社，成员皆烙有灵脉印记，立誓于灵脉枯竭之时。',
      comments: [],
      createdAt: 0, updatedAt: 0 }),
    mkVer({ id: 'en-fac-2', type: 'faction', name: '黯蚀教团',
      fields: [
        { label: '性质', value: '秘教组织' },
        { label: '领袖', value: 'en-char-4', kind: 'entity', entityType: ['character'] },
        { label: '据点', value: '幽潮深渊' },
        { label: '信条', value: '灵脉当归于虚无' },
        { label: '势力范围', value: '深渊周边' },
      ],
      custom: [{ label: '圣物', value: '陨核碎片' }],
      tags: ['黯蚀教团'],
      note: '崇拜灵脉枯竭的狂热教团，视吞噬灵脉为“净化”。',
      comments: [],
      createdAt: 0, updatedAt: 0 }),
    mkVer({ id: 'en-fac-3', type: 'faction', name: '云隐城议会',
      fields: [
        { label: '性质', value: '城邦议会' },
        { label: '领袖', value: '城主议长' },
        { label: '据点', value: '云隐城' },
        { label: '信条', value: '维系浮空之城' },
        { label: '势力范围', value: '云隐城及附属空岛' },
      ],
      custom: [],
      tags: ['云隐城'],
      note: '治理浮空城邦的世俗权力，与守夜人既合作又戒备。',
      comments: [],
      createdAt: 0, updatedAt: 0 }),
    mkVer({ id: 'en-loc-1', type: 'location', name: '云隐城',
      fields: [
        { label: '类型', value: '浮空城邦' },
        { label: '坐标', value: '灵脉上空' },
        { label: '统治者', value: '云隐城议会' },
        { label: '气候', value: '常春' },
        { label: '风俗', value: '悬灯祭灵脉' },
      ],
      custom: [{ label: '人口', value: '数万' }],
      tags: ['浮空'],
      note: '以灵脉为锚悬浮于云海之上的最后乐土。',
      comments: [],
      createdAt: 0, updatedAt: 0 }),
    mkVer({ id: 'en-loc-2', type: 'location', name: '星陨谷',
      fields: [
        { label: '类型', value: '陨坑遗迹' },
        { label: '坐标', value: '大陆北境' },
        { label: '统治者', value: '无' },
        { label: '气候', value: '酷寒' },
        { label: '风俗', value: '朝圣者留下石标' },
      ],
      custom: [{ label: '秘宝', value: '初代陨星残骸' }],
      tags: ['圣迹'],
      note: '星陨之夜陨星坠落之地，灵脉由此涌入人间。',
      comments: [],
      createdAt: 0, updatedAt: 0 }),
    mkVer({ id: 'en-loc-3', type: 'location', name: '幽潮深渊',
      fields: [
        { label: '类型', value: '灵脉枯竭裂谷' },
        { label: '坐标', value: '大陆西陲' },
        { label: '统治者', value: '黯蚀教团' },
        { label: '气候', value: '阴冷' },
        { label: '风俗', value: '教团献祭' },
      ],
      custom: [{ label: '深度', value: '未知' }],
      tags: ['黯蚀教团', '险地'],
      note: '灵脉枯竭后裂开的深渊，黯蚀教团的圣地。',
      comments: [],
      createdAt: 0, updatedAt: 0 }),
    mkVer({ id: 'en-evt-1', type: 'event', name: '星陨之夜',
      fields: [
        { label: '时间', value: '纪元0年' },
        { label: '参与方', value: '守夜人 / 民众' },
        { label: '起因', value: '天外陨星坠落' },
        { label: '结果', value: '灵脉显现' },
      ],
      custom: [], tags: [],
      note: '一切故事的开端。',
      comments: [],
      createdAt: 0, updatedAt: 0 }),
    mkVer({ id: 'en-evt-2', type: 'event', name: '云隐城升空',
      fields: [
        { label: '时间', value: '纪元12年' },
        { label: '参与方', value: '云隐城议会' },
        { label: '起因', value: '灵脉锚定' },
        { label: '结果', value: '浮空城邦成型' },
      ],
      custom: [], tags: [],
      note: '人类借灵脉之力离开大地，仰望星海。',
      comments: [],
      createdAt: 0, updatedAt: 0 }),
    mkVer({ id: 'en-evt-3', type: 'event', name: '灵脉枯竭',
      fields: [
        { label: '时间', value: '纪元30年' },
        { label: '参与方', value: '天地灵脉' },
        { label: '起因', value: '灵脉过度汲取' },
        { label: '结果', value: '深渊显现' },
      ],
      custom: [], tags: ['危机'],
      note: '灵脉骤然衰减，世界开始失去颜色。',
      comments: [],
      createdAt: 0, updatedAt: 0 }),
    mkVer({ id: 'en-evt-4', type: 'event', name: '守夜人誓约',
      fields: [
        { label: '时间', value: '纪元41年' },
        { label: '参与方', value: '守夜人' },
        { label: '起因', value: '灵脉枯竭' },
        { label: '结果', value: '立誓守护' },
      ],
      custom: [], tags: [],
      note: '玄于深渊之畔率众立下守护之誓。',
      comments: [],
      createdAt: 0, updatedAt: 0 }),
    mkVer({ id: 'en-evt-5', type: 'event', name: '黯蚀之忧',
      fields: [
        { label: '时间', value: '纪元52年' },
        { label: '参与方', value: '黯蚀教团' },
        { label: '起因', value: '深渊灵脉涌动' },
        { label: '结果', value: '教团崛起' },
      ],
      custom: [], tags: ['危机'],
      note: '黯蚀教团自深渊走出，世界再掀波澜。',
      comments: [],
      createdAt: 0, updatedAt: 0 }),
    mkVer({ id: 'en-rule-1', type: 'rule', name: '灵脉法则',
      fields: [
        { label: '领域', value: '能量' },
        { label: '内容', value: '灵脉为世界本源能量' },
        { label: '例外', value: '枯竭后由守夜人维系' },
      ],
      custom: [], tags: ['灵脉'],
      note: '世界运行的底层规则。',
      comments: [],
      createdAt: 0, updatedAt: 0 }),
    mkVer({ id: 'en-rule-2', type: 'rule', name: '守夜契约',
      fields: [
        { label: '领域', value: '誓约' },
        { label: '内容', value: '守夜人须以命守护灵脉' },
        { label: '例外', value: '大守夜可赦免' },
      ],
      custom: [], tags: ['守夜人'],
      note: '约束每一位守夜人的铁律。',
      comments: [],
      createdAt: 0, updatedAt: 0 }),
  ],
  relations: [
    { id: 'rel-1', source: 'en-char-1', target: 'en-fac-1', type: 'belongs', label: '林夜是守夜人学徒', createdAt: 0 },
    { id: 'rel-2', source: 'en-char-2', target: 'en-fac-1', type: 'belongs', label: '苏泠加入守夜人', createdAt: 0 },
    { id: 'rel-3', source: 'en-char-3', target: 'en-fac-1', type: 'belongs', label: '玄是现任大守夜', createdAt: 0 },
    { id: 'rel-4', source: 'en-char-4', target: 'en-fac-2', type: 'belongs', label: '蚀执掌黯蚀教团', createdAt: 0 },
    { id: 'rel-5', source: 'en-loc-1', target: 'en-fac-1', type: 'belongs', label: '云隐城为守夜人据点', createdAt: 0 },
    { id: 'rel-6', source: 'en-loc-1', target: 'en-fac-3', type: 'belongs', label: '云隐城由议会治理', createdAt: 0 },
    { id: 'rel-7', source: 'en-evt-1', target: 'en-loc-1', type: 'occurs', label: '星陨之夜发生于云隐城上空', createdAt: 0 },
    { id: 'rel-8', source: 'en-evt-2', target: 'en-loc-1', type: 'occurs', label: '云隐城升空依托灵脉锚点', createdAt: 0 },
    { id: 'rel-9', source: 'en-evt-3', target: 'en-loc-3', type: 'occurs', label: '灵脉枯竭显于幽潮深渊', createdAt: 0 },
    { id: 'rel-10', source: 'en-evt-5', target: 'en-loc-3', type: 'occurs', label: '黯蚀之忧源于幽潮深渊', createdAt: 0 },
    { id: 'rel-11', source: 'en-fac-1', target: 'en-fac-2', type: 'enemy', label: '守夜人与黯蚀教团世代敌对', createdAt: 0 },
    { id: 'rel-12', source: 'en-char-3', target: 'en-char-4', type: 'kin', label: '玄与蚀本是同门师兄弟', createdAt: 0 },
    { id: 'rel-13', source: 'en-char-2', target: 'en-char-3', type: 'kin', label: '苏泠是玄的养女', createdAt: 0 },
    { id: 'rel-14', source: 'en-evt-3', target: 'en-fac-2', type: 'causal', label: '灵脉枯竭催生黯蚀教团', createdAt: 0 },
    { id: 'rel-15', source: 'en-evt-1', target: 'en-evt-3', type: 'causal', label: '星陨之夜埋下灵脉枯竭之因', createdAt: 0 },
    { id: 'rel-16', source: 'en-rule-1', target: 'en-fac-1', type: 'custom', label: '灵脉法则由守夜人维系', createdAt: 0 },
    { id: 'rel-17', source: 'en-rule-2', target: 'en-fac-1', type: 'custom', label: '守夜契约约束守夜人', createdAt: 0 },
    { id: 'rel-18', source: 'en-char-1', target: 'en-char-2', type: 'kin', label: '林夜与苏泠是生死同伴', createdAt: 0 },
  ],
  drafts: [
    { id: 'draft-1', title: '灵感 · 灵脉枯竭之后', content: '当灵脉彻底熄灭，云隐城坠落，守夜人该何去何从？', createdAt: 0 },
    { id: 'draft-2', title: '灵感 · 苏泠的身世之谜', content: '苏泠与玄的真实关系，是养父女还是更深的羁绊？', createdAt: 0 },
    { id: 'draft-3', title: '灵感 · 双生决裂的场景', content: '玄与蚀于深渊之畔对峙，三十年同门情在此刻化作刀光。', createdAt: 0 },
  ],
  proposals: [DEMO_PROPOSAL],
  chats: [],
};

let docSeq = 100;
let tlSeq = 100;
let evSeq = 100;

export const useWorldStore = create<WorldState>((set, get): WorldState => {
  const isNative = storage.isNative();
  const persistedData = migrateTimelineEntities(loadAllData());
  const existing = persistedData[DEFAULT_WORLD];
  if (!existing) {
    // 首次启动：注入默认示例世界
    persistedData[DEFAULT_WORLD] = DEFAULT_DATA;
    // 桌面版（本地文件系统）不在此处落盘，避免覆盖磁盘上由 main.tsx 统一加载的真实数据；
    // 浏览器/预览环境仍写入 localStorage 作为兜底
    if (!isNative) saveAllData(persistedData);
  } else {
    // 已知演示种子若 seedVersion 落后，则启动时强制升级为最新演示工程
    const isStaleSample = isDefaultWorldEmpty(existing);
    if (isStaleSample || isOldDemo(existing) || (isKnownDemoSeed(existing) && (existing.seedVersion ?? 0) < CURRENT_SEED_VERSION)) {
      persistedData[DEFAULT_WORLD] = DEFAULT_DATA;
      if (!isNative) saveAllData(persistedData);
    }
  }
  const initialCurrent = storage.isNative()
    ? DEFAULT_WORLD
    : (() => { try { return localStorage.getItem(LS_CURRENT) || DEFAULT_WORLD; } catch { return DEFAULT_WORLD; } })();

  return {
    current: initialCurrent,
    worldsData: persistedData,
    dirty: false,
    selectedTree: null,
    /* —— 工具集 —— */
    getDoc: (id) => get().worldsData[get().current]?.docs.find((d) => d.id === id),
    updateDocContent: (id, content) => {
      const w = get().current; set((s) => { const wd = s.worldsData[w]; if (!wd) return s; const next = { ...s, worldsData: { ...s.worldsData, [w]: { ...wd, docs: wd.docs.map((d) => d.id === id ? { ...d, content } : d) } }, dirty: true }; saveAllData(next.worldsData); return next; });
    },
    setActiveDoc: (id) => { const w = get().current; set((s) => { const wd = s.worldsData[w]; if (!wd) return s; return { ...s, worldsData: { ...s.worldsData, [w]: { ...wd, activeDocId: id } } }; }); },
    setActiveTimeline: (id) => { const w = get().current; set((s) => { const wd = s.worldsData[w]; if (!wd) return s; return { ...s, worldsData: { ...s.worldsData, [w]: { ...wd, activeTimelineId: id } } }; }); },
    addTimeline: (name) => {
      const id = `tl-${tlSeq++}`;
      set((s) => { const w = s.current; const wd = s.worldsData[w]; if (!wd) return s; const tl: Timeline = { id, name, unit: 'year', events: [] }; const next = { ...s, worldsData: { ...s.worldsData, [w]: { ...wd, timelines: [...wd.timelines, tl], activeTimelineId: id } }, dirty: true }; saveAllData(next.worldsData); return next; });
    },
    addTimelineEvent: (timelineId, ev, opts) => {
      const id = `ev-${evSeq++}`;
      set((s) => {
        const w = s.current; const wd = s.worldsData[w]; if (!wd) return s;
        const event = { ...ev, id } as Timeline['events'][number];
        const next = { ...s, worldsData: { ...s.worldsData, [w]: { ...wd, timelines: wd.timelines.map((t) => t.id === timelineId ? { ...t, events: [...t.events, event] } : t) } }, dirty: true };
        saveAllData(next.worldsData); return next;
      });
      return id;
    },
    updateTimelineEvent: (timelineId, eventId, patch) => {
      set((s) => {
        const w = s.current; const wd = s.worldsData[w]; if (!wd) return s;
        const next = { ...s, worldsData: { ...s.worldsData, [w]: { ...wd, timelines: wd.timelines.map((t) => t.id === timelineId ? { ...t, events: t.events.map((e) => e.id === eventId ? { ...e, ...patch } : e) } : t) } }, dirty: true };
        saveAllData(next.worldsData); return next;
      });
    },
    deleteTimelineEvent: (timelineId, eventId) => {
      set((s) => {
        const w = s.current; const wd = s.worldsData[w]; if (!wd) return s;
        const next = { ...s, worldsData: { ...s.worldsData, [w]: { ...wd, timelines: wd.timelines.map((t) => t.id === timelineId ? { ...t, events: t.events.filter((e) => e.id !== eventId) } : t) } }, dirty: true };
        saveAllData(next.worldsData); return next;
      });
    },
    setTimelineUnit: (id, unit, unitLabel) => {
      set((s) => { const w = s.current; const wd = s.worldsData[w]; if (!wd) return s; const next = { ...s, worldsData: { ...s.worldsData, [w]: { ...wd, timelines: wd.timelines.map((t) => t.id === id ? { ...t, unit, unitLabel: unit === 'custom' ? unitLabel : undefined } : t) } } }; saveAllData(next.worldsData); return next; });
    },
    /* —— 文件管理 —— */
    setSelectedTree: (sel) => set({ selectedTree: sel }),
    addDoc: (title, folder) => {
      const id = `doc-${docSeq++}`;
      set((s) => { const w = s.current; const wd = s.worldsData[w]; if (!wd) return s; const next = { ...s, worldsData: { ...s.worldsData, [w]: { ...wd, docs: [...wd.docs, { id, title, icon: '', folder, content: { type: 'doc', content: [] } }], activeDocId: id } }, dirty: true }; saveAllData(next.worldsData); return next; });
    },
    addFolder: (name) => {
      set((s) => { const w = s.current; const wd = s.worldsData[w]; if (!wd) return s; if (wd.folders.includes(name)) return s; const next = { ...s, worldsData: { ...s.worldsData, [w]: { ...wd, folders: [...wd.folders, name] } }, dirty: true }; saveAllData(next.worldsData); return next; });
    },
    deleteDoc: (id) => { set((s) => { const w = s.current; const wd = s.worldsData[w]; if (!wd) return s; const next = { ...s, worldsData: { ...s.worldsData, [w]: { ...wd, docs: wd.docs.filter((d) => d.id !== id) } }, dirty: true }; saveAllData(next.worldsData); return next; }); typeof window !== 'undefined' && window.dispatchEvent(new CustomEvent('fg-close-tabs', { detail: { kind: 'doc', ref: id } })); },
    deleteFolder: (name) => { set((s) => { const w = s.current; const wd = s.worldsData[w]; if (!wd) return s; const next = { ...s, worldsData: { ...s.worldsData, [w]: { ...wd, folders: wd.folders.filter((f) => f !== name), docs: wd.docs.filter((d) => d.folder !== name) } }, dirty: true }; saveAllData(next.worldsData); return next; }); },
    deleteTimeline: (id) => { set((s) => { const w = s.current; const wd = s.worldsData[w]; if (!wd) return s; const tl = wd.timelines.filter((t) => t.id !== id); const next = { ...s, worldsData: { ...s.worldsData, [w]: { ...wd, timelines: tl, activeTimelineId: tl.length ? tl[0].id : '' } }, dirty: true }; saveAllData(next.worldsData); return next; }); typeof window !== 'undefined' && window.dispatchEvent(new CustomEvent('fg-close-tabs', { detail: { kind: 'timeline', ref: id } })); },
    renameDoc: (id, title) => { set((s) => { const w = s.current; const wd = s.worldsData[w]; if (!wd) return s; const next = { ...s, worldsData: { ...s.worldsData, [w]: { ...wd, docs: wd.docs.map((d) => d.id === id ? { ...d, title } : d) } }, dirty: true }; saveAllData(next.worldsData); return next; }); },
    renameTimeline: (id, name) => { set((s) => { const w = s.current; const wd = s.worldsData[w]; if (!wd) return s; const next = { ...s, worldsData: { ...s.worldsData, [w]: { ...wd, timelines: wd.timelines.map((t) => t.id === id ? { ...t, name } : t) } }, dirty: true }; saveAllData(next.worldsData); return next; }); },
    updateDocIcon: (id, icon) => { set((s) => { const w = s.current; const wd = s.worldsData[w]; if (!wd) return s; const next = { ...s, worldsData: { ...s.worldsData, [w]: { ...wd, docs: wd.docs.map((d) => d.id === id ? { ...d, icon } : d) } }, dirty: true }; saveAllData(next.worldsData); return next; }); },
    moveDocToFolder: (id, folder) => { set((s) => { const w = s.current; const wd = s.worldsData[w]; if (!wd) return s; const next = { ...s, worldsData: { ...s.worldsData, [w]: { ...wd, docs: wd.docs.map((d) => d.id === id ? { ...d, folder } : d) } }, dirty: true }; saveAllData(next.worldsData); return next; }); },
    /* —— 视觉物料生成器（P0-1d）：风格与产出 —— */
    addStyle: (input) => {
      const id = `ms-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const now = Date.now();
      const style: MaterialStyle = { id, createdAt: now, updatedAt: now, ...input };
      set((s) => { const wd = s.worldsData[s.current]; if (!wd) return s; const next = { ...s, worldsData: { ...s.worldsData, [s.current]: { ...wd, styles: [...(wd.styles ?? []), style] } }, dirty: true }; saveAllData(next.worldsData); return next; });
      return id;
    },
    updateStyle: (id, patch) => {
      set((s) => { const wd = s.worldsData[s.current]; if (!wd) return s; const next = { ...s, worldsData: { ...s.worldsData, [s.current]: { ...wd, styles: (wd.styles ?? []).map((x) => x.id === id ? { ...x, ...patch, updatedAt: Date.now() } : x) } }, dirty: true }; saveAllData(next.worldsData); return next; });
    },
    deleteStyle: (id) => {
      set((s) => { const wd = s.worldsData[s.current]; if (!wd) return s; const next = { ...s, worldsData: { ...s.worldsData, [s.current]: { ...wd, styles: (wd.styles ?? []).filter((x) => x.id !== id) } }, dirty: true }; saveAllData(next.worldsData); return next; });
    },
    addMaterial: (input) => {
      const id = `gm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const now = Date.now();
      const m: GeneratedMaterial = { id, createdAt: now, updatedAt: now, ...input };
      set((s) => { const wd = s.worldsData[s.current]; if (!wd) return s; const next = { ...s, worldsData: { ...s.worldsData, [s.current]: { ...wd, materials: [...(wd.materials ?? []), m] } }, dirty: true }; saveAllData(next.worldsData); return next; });
      return id;
    },
    updateMaterial: (id, patch) => {
      set((s) => { const wd = s.worldsData[s.current]; if (!wd) return s; const next = { ...s, worldsData: { ...s.worldsData, [s.current]: { ...wd, materials: (wd.materials ?? []).map((x) => x.id === id ? { ...x, ...patch, updatedAt: Date.now() } : x) } }, dirty: true }; saveAllData(next.worldsData); return next; });
    },
    deleteMaterial: (id) => {
      set((s) => { const wd = s.worldsData[s.current]; if (!wd) return s; const next = { ...s, worldsData: { ...s.worldsData, [s.current]: { ...wd, materials: (wd.materials ?? []).filter((x) => x.id !== id) } }, dirty: true }; saveAllData(next.worldsData); return next; });
    },
    addTemplate: (tpl) => {
      set((s) => { const wd = s.worldsData[s.current]; if (!wd) return s; const next = { ...s, worldsData: { ...s.worldsData, [s.current]: { ...wd, templates: [...(wd.templates ?? []), tpl] } }, dirty: true }; saveAllData(next.worldsData); return next; });
      return tpl.id;
    },
    updateTemplate: (id, patch) => {
      set((s) => { const wd = s.worldsData[s.current]; if (!wd) return s; const next = { ...s, worldsData: { ...s.worldsData, [s.current]: { ...wd, templates: (wd.templates ?? []).map((x) => x.id === id ? { ...x, ...patch } : x) } }, dirty: true }; saveAllData(next.worldsData); return next; });
    },
    deleteTemplate: (id) => {
      set((s) => { const wd = s.worldsData[s.current]; if (!wd) return s; const next = { ...s, worldsData: { ...s.worldsData, [s.current]: { ...wd, templates: (wd.templates ?? []).filter((x) => x.id !== id) } }, dirty: true }; saveAllData(next.worldsData); return next; });
    },
    addEntity: (input) => {
      const id = input.id || `en-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
      const now = Date.now();
      const base = { name: input.name || '未命名', type: input.type, fields: input.fields ?? [], custom: input.custom ?? [], tags: input.tags ?? [], note: input.note, images: input.images ?? [], coverImageId: input.coverImageId };
      const ent: WikiEntity = {
        id, ...base,
        materialFields: input.materialFields,
        portrait: input.portrait,
        spectrumColor: input.spectrumColor,
        comments: [], versions: [{ version: 1, ts: now, snapshot: base }], createdAt: now, updatedAt: now,
      };
      set((s) => {
        const wd = s.worldsData[s.current]; if (!wd) return s;
        const next = { ...s, worldsData: { ...s.worldsData, [s.current]: { ...wd, entities: [...wd.entities, ent] } }, dirty: true };
        saveAllData(next.worldsData); return next;
      });
      return id;
    },
    updateEntity: (id, patch) => {
      set((s) => {
        const wd = s.worldsData[s.current]; if (!wd) return s;
        const updatedEntities = wd.entities.map((e) => e.id === id ? { ...e, ...patch, updatedAt: Date.now() } : e);
        const next = { ...s, worldsData: { ...s.worldsData, [s.current]: { ...wd, entities: updatedEntities } }, dirty: true };
        saveAllData(next.worldsData); return next;
      });
    },
    deleteEntity: (id) => {
      set((s) => {
        const wd = s.worldsData[s.current]; if (!wd) return s;
        const timelines = wd.timelines.map((tl) => ({ ...tl, events: tl.events.map((e) => e.entityId === id ? { ...e, entityId: undefined } : e) }));
        const next = { ...s, worldsData: { ...s.worldsData, [s.current]: { ...wd, entities: wd.entities.filter((e) => e.id !== id), relations: wd.relations.filter((r) => r.source !== id && r.target !== id), timelines } }, dirty: true };
        saveAllData(next.worldsData); return next;
      });
      typeof window !== 'undefined' && window.dispatchEvent(new CustomEvent('fg-close-tabs', { detail: { kind: 'entity', ref: id } }));
    },
    addEntityImage: (entityId, dataUrl, name) => {
      set((s) => {
        const wd = s.worldsData[s.current]; if (!wd) return s;
        const img: import('../types').EntityImage = { id: `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`, dataUrl, name: name || `插图 ${(wd.entities.find((e) => e.id === entityId)?.images?.length ?? 0) + 1}`, createdAt: Date.now() };
        const next = { ...s, worldsData: { ...s.worldsData, [s.current]: { ...wd, entities: wd.entities.map((e) => {
          if (e.id !== entityId) return e;
          const images = [...(e.images ?? []), img];
          return { ...e, images, coverImageId: e.coverImageId ?? img.id, updatedAt: Date.now() };
        }) } }, dirty: true };
        saveAllData(next.worldsData); return next;
      });
    },
    removeEntityImage: (entityId, imageId) => {
      set((s) => {
        const wd = s.worldsData[s.current]; if (!wd) return s;
        const next = { ...s, worldsData: { ...s.worldsData, [s.current]: { ...wd, entities: wd.entities.map((e) => {
          if (e.id !== entityId) return e;
          const images = (e.images ?? []).filter((i) => i.id !== imageId);
          let coverImageId = e.coverImageId;
          if (coverImageId === imageId) coverImageId = images[0]?.id;
          return { ...e, images, coverImageId, updatedAt: Date.now() };
        }) } }, dirty: true };
        saveAllData(next.worldsData); return next;
      });
    },
    setEntityCoverImage: (entityId, imageId) => {
      set((s) => {
        const wd = s.worldsData[s.current]; if (!wd) return s;
        const next = { ...s, worldsData: { ...s.worldsData, [s.current]: { ...wd, entities: wd.entities.map((e) => e.id === entityId ? { ...e, coverImageId: imageId, updatedAt: Date.now() } : e) } }, dirty: true };
        saveAllData(next.worldsData); return next;
      });
    },
    addEntityComment: (entityId, author, content) => {
      set((s) => {
        const wd = s.worldsData[s.current]; if (!wd) return s;
        const next = { ...s, worldsData: { ...s.worldsData, [s.current]: { ...wd, entities: wd.entities.map((e) => e.id === entityId ? { ...e, comments: [...(e.comments ?? []), { id: 'c-' + Date.now().toString(36), author: author || '匿名', content, ts: Date.now() }] } : e) } }, dirty: true };
        saveAllData(next.worldsData); return next;
      });
    },
    saveEntityVersion: (entityId) => {
      set((s) => {
        const wd = s.worldsData[s.current]; if (!wd) return s;
        const next = { ...s, worldsData: { ...s.worldsData, [s.current]: { ...wd, entities: wd.entities.map((e) => {
          if (e.id !== entityId) return e;
          const versions = e.versions ?? [];
          const snap = { name: e.name, type: e.type, fields: e.fields, custom: e.custom, tags: e.tags, note: e.note, images: e.images, coverImageId: e.coverImageId };
          return { ...e, versions: [...versions, { version: versions.length + 1, ts: Date.now(), snapshot: snap }] };
        }) } }, dirty: true };
        saveAllData(next.worldsData); return next;
      });
    },
    restoreEntityVersion: (entityId, version) => {
      set((s) => {
        const wd = s.worldsData[s.current]; if (!wd) return s;
        const next = { ...s, worldsData: { ...s.worldsData, [s.current]: { ...wd, entities: wd.entities.map((e) => {
          if (e.id !== entityId) return e;
          const v = (e.versions ?? []).find((x) => x.version === version);
          if (!v) return e;
          return { ...e, ...v.snapshot, updatedAt: Date.now() };
        }) } }, dirty: true };
        saveAllData(next.worldsData); return next;
      });
    },
    mergeImported: (entities, relations) => {
      set((s) => {
        const wd = s.worldsData[s.current]; if (!wd) return s;
        // 防御 P0-1.3：导入实体若与本地同 ID，重命名以避免重复 id 入库导致数据损坏
        const existingIds = new Set(wd.entities.map((e) => e.id));
        const idMap = new Map<string, string>(); // 导入原 id -> 最终 id
        const safeEntities: WikiEntity[] = [];
        for (const e of entities) {
          let newId = e.id;
          if (existingIds.has(newId) || idMap.has(newId)) {
            let i = 1;
            do { newId = `${e.id}-imp${i++}`; } while (existingIds.has(newId) || idMap.has(newId) || safeEntities.some((x) => x.id === newId));
          }
          idMap.set(e.id, newId);
          safeEntities.push(newId === e.id ? e : { ...e, id: newId });
          existingIds.add(newId);
        }
        // 仅保留两端实体都来自本次导入的关系，并将端点重映射到最终 id
        const rels = relations
          .filter((r) => idMap.has(r.source) && idMap.has(r.target))
          .map((r) => ({
            ...r,
            id: `imp-${r.source}-${r.target}-${r.type}-${Math.random().toString(36).slice(2, 7)}`,
            source: idMap.get(r.source)!,
            target: idMap.get(r.target)!,
          }));
        const next = { ...s, worldsData: { ...s.worldsData, [s.current]: { ...wd, entities: [...wd.entities, ...safeEntities], relations: [...wd.relations, ...rels] } }, dirty: true };
        saveAllData(next.worldsData); return next;
      });
    },
    addRelation: (source, target, type, label) => {
      if (source === target) return;
      const w = get().current; const wd = get().worldsData[w]; if (!wd) return;
      if (wd.relations.some((r) => r.source === source && r.target === target && r.type === type)) return;
      const rel: WikiRelation = { id: `rel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`, source, target, type, label, createdAt: Date.now() };
      set((s) => {
        const wd = s.worldsData[s.current]; if (!wd) return s;
        const next = { ...s, worldsData: { ...s.worldsData, [s.current]: { ...wd, relations: [...wd.relations, rel] } }, dirty: true };
        saveAllData(next.worldsData); return next;
      });
    },
    updateRelation: (id, patch) => {
      set((s) => {
        const wd = s.worldsData[s.current]; if (!wd) return s;
        const next = { ...s, worldsData: { ...s.worldsData, [s.current]: { ...wd, relations: wd.relations.map((r) => r.id === id ? { ...r, ...patch } : r) } }, dirty: true };
        saveAllData(next.worldsData); return next;
      });
    },
    removeRelation: (id) => {
      set((s) => {
        const wd = s.worldsData[s.current]; if (!wd) return s;
        const next = { ...s, worldsData: { ...s.worldsData, [s.current]: { ...wd, relations: wd.relations.filter((r) => r.id !== id) } }, dirty: true };
        saveAllData(next.worldsData); return next;
      });
    },
    clearRelations: () => {
      set((s) => {
        const wd = s.worldsData[s.current]; if (!wd) return s;
        const next = { ...s, worldsData: { ...s.worldsData, [s.current]: { ...wd, relations: [] } }, dirty: true };
        saveAllData(next.worldsData); return next;
      });
    },
    setClueBoardBackground: (image) => {
      set((s) => {
        const wd = s.worldsData[s.current]; if (!wd) return s;
        const next = { ...s, worldsData: { ...s.worldsData, [s.current]: { ...wd, clueBoard: { ...wd.clueBoard, backgroundImage: image } } }, dirty: true };
        saveAllData(next.worldsData); return next;
      });
    },
    removeClueBoardBackground: () => {
      set((s) => {
        const wd = s.worldsData[s.current]; if (!wd) return s;
        const next = { ...s, worldsData: { ...s.worldsData, [s.current]: { ...wd, clueBoard: { ...wd.clueBoard, backgroundImage: undefined } } }, dirty: true };
        saveAllData(next.worldsData); return next;
      });
    },
    setClueBoardBackgroundFit: (fit) => {
      set((s) => {
        const wd = s.worldsData[s.current]; if (!wd) return s;
        const next = { ...s, worldsData: { ...s.worldsData, [s.current]: { ...wd, clueBoard: { ...wd.clueBoard, backgroundFit: fit } } }, dirty: true };
        saveAllData(next.worldsData); return next;
      });
    },
    setClueBoardBackgroundScale: (scale) => {
      set((s) => {
        const wd = s.worldsData[s.current]; if (!wd) return s;
        const next = { ...s, worldsData: { ...s.worldsData, [s.current]: { ...wd, clueBoard: { ...wd.clueBoard, backgroundScale: scale } } }, dirty: true };
        saveAllData(next.worldsData); return next;
      });
    },
    addDraft: (title, content) => { set((s) => { const w = s.current; const wd = s.worldsData[w]; if (!wd) return s; const id = `df-${Date.now()}-${Math.random().toString(36).slice(2,6)}`; const next = { ...s, worldsData: { ...s.worldsData, [w]: { ...wd, drafts: [...(wd.drafts ?? []), { id, title, content, createdAt: Date.now() }] } }, dirty: true }; saveAllData(next.worldsData); return next; }); },
    updateDraft: (id, title, content) => { set((s) => { const w = s.current; const wd = s.worldsData[w]; if (!wd) return s; const next = { ...s, worldsData: { ...s.worldsData, [w]: { ...wd, drafts: (wd.drafts ?? []).map((d) => d.id === id ? { ...d, title, content } : d) } }, dirty: true }; saveAllData(next.worldsData); return next; }); },
    deleteDraft: (id) => { set((s) => { const w = s.current; const wd = s.worldsData[w]; if (!wd) return s; const next = { ...s, worldsData: { ...s.worldsData, [w]: { ...wd, drafts: (wd.drafts ?? []).filter((d) => d.id !== id) } }, dirty: true }; saveAllData(next.worldsData); return next; }); },
    /* —— 世界管理 —— */
    addWorld: (name, template = 'empty') => {
      const tmpl = TEMPLATES[template] || TEMPLATES.empty;
      const wd = tmpl();
      set((s) => { const next = { ...s, worldsData: { ...s.worldsData, [name]: wd }, dirty: true }; saveAllData(next.worldsData); return next; });
    },
    removeWorld: (name, nextName) => {
      set((s) => {
        const { [name]: _, ...rest } = s.worldsData;
        const removedCurrent = s.current === name;
        const fallback = Object.keys(rest)[0] || DEFAULT_WORLD;
        const newCurrent = removedCurrent
          ? (nextName && rest[nextName] ? nextName : fallback)
          : s.current;
        const next: WorldState = { ...s, worldsData: rest, current: newCurrent, dirty: false } as any;
        saveAllData(next.worldsData);
        if (removedCurrent) storage.saveCurrent(newCurrent);
        return next;
      });
    },
    renameWorld: (oldName, newName) => {
      set((s) => {
        if (oldName === newName) return s;
        const data = s.worldsData[oldName];
        if (!data) return s;
        if (s.worldsData[newName]) return s;
        const nextData: Record<string, WorldData> = {};
        for (const [k, v] of Object.entries(s.worldsData)) {
          if (k === oldName) continue;
          nextData[k] = v;
        }
        nextData[newName] = data;
        const currentChanged = s.current === oldName;
        const next: WorldState = { ...s, worldsData: nextData, current: currentChanged ? newName : s.current, dirty: false } as any;
        saveAllData(nextData);
        if (currentChanged) storage.saveCurrent(newName);
        return next;
      });
    },
    switchWorld: async (name, onPrompt) => {
      const cur = get().current;
      if (name === cur) return true;
      if (get().dirty && onPrompt) {
        const action = await onPrompt(cur);
        if (action === 'cancel') return false;
        // save 时确保已写盘（addWorld 等已自动 saveAllData），discard 也无额外动作
      }
      storage.saveCurrent(name);
      set({ current: name, dirty: false });
      return true;
    },
    markDirty: () => set({ dirty: true }),
    markClean: () => set({ dirty: false }),
    saveNow: () => {
      const s = get();
      saveAllData(s.worldsData);
      set({ dirty: false });
    },
    /* —— AI 提案队列（Phase 0） —— */
    addProposal: (input) => {
      const id = `pp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      set((s) => {
        const wd = s.worldsData[s.current]; if (!wd) return s;
        const p: Proposal = { id, status: 'pending', createdAt: Date.now(), ...input };
        const proposals = [...(wd.proposals ?? []), p];
        const next = { ...s, worldsData: { ...s.worldsData, [s.current]: { ...wd, proposals } }, dirty: true };
        saveAllData(next.worldsData); return next;
      });
      return id;
    },
    acceptProposal: (id) => {
      const s = get();
      const wd = s.worldsData[s.current]; if (!wd) return;
      const p = (wd.proposals ?? []).find((x) => x.id === id);
      if (!p || p.status !== 'pending') return;
      dispatchProposal(p);
      set((st) => {
        const w = st.worldsData[st.current]; if (!w) return st;
        const proposals = (w.proposals ?? []).map((x) => x.id === id ? { ...x, status: 'accepted' as const } : x);
        const next = { ...st, worldsData: { ...st.worldsData, [st.current]: { ...w, proposals } }, dirty: true };
        saveAllData(next.worldsData); return next;
      });
    },
    rejectProposal: (id) => {
      set((s) => {
        const wd = s.worldsData[s.current]; if (!wd) return s;
        const proposals = (wd.proposals ?? []).map((x) => x.id === id ? { ...x, status: 'rejected' as const } : x);
        const next = { ...s, worldsData: { ...s.worldsData, [s.current]: { ...wd, proposals } }, dirty: true };
        saveAllData(next.worldsData); return next;
      });
    },
    acceptAllProposals: () => {
      const s = get();
      const wd = s.worldsData[s.current]; if (!wd) return;
      const pending = (wd.proposals ?? []).filter((x) => x.status === 'pending');
      pending.forEach((p) => dispatchProposal(p));
      set((st) => {
        const w = st.worldsData[st.current]; if (!w) return st;
        const proposals = (w.proposals ?? []).map((x) => x.status === 'pending' ? { ...x, status: 'accepted' as const } : x);
        const next = { ...st, worldsData: { ...st.worldsData, [st.current]: { ...w, proposals } }, dirty: true };
        saveAllData(next.worldsData); return next;
      });
    },
    clearResolvedProposals: () => {
      set((s) => {
        const wd = s.worldsData[s.current]; if (!wd) return s;
        const proposals = (wd.proposals ?? []).filter((x) => x.status === 'pending');
        const next = { ...s, worldsData: { ...s.worldsData, [s.current]: { ...wd, proposals } }, dirty: true };
        saveAllData(next.worldsData); return next;
      });
    },
    /* —— AI 对话持久化（Phase 0） —— */
    upsertChat: (worldKey, chat) => {
      set((s) => {
        const wd = s.worldsData[worldKey]; if (!wd) return s;
        const chats = [...(wd.chats ?? [])];
        const idx = chats.findIndex((c) => c.id === chat.id);
        if (idx >= 0) chats[idx] = chat; else chats.push(chat);
        const next = { ...s, worldsData: { ...s.worldsData, [worldKey]: { ...wd, chats } }, dirty: true };
        saveAllData(next.worldsData); return next;
      });
    },
    getChat: (worldKey, id) => {
      const wd = get().worldsData[worldKey];
      return (wd?.chats ?? []).find((c) => c.id === id);
    },
    deleteChat: (worldKey, id) => {
      set((s) => {
        const wd = s.worldsData[worldKey]; if (!wd) return s;
        const chats = (wd.chats ?? []).filter((c) => c.id !== id);
        const next = { ...s, worldsData: { ...s.worldsData, [worldKey]: { ...wd, chats } }, dirty: true };
        saveAllData(next.worldsData); return next;
      });
    },
  } as WorldState;
});

/** 把一条提案的操作落到世界数据（Phase 0） */
function dispatchProposal(p: Proposal) {
  const ws = useWorldStore.getState();
  switch (p.op.kind) {
    case 'addEntity':
      ws.addEntity(p.op.entity);
      break;
    case 'addRelation':
      ws.addRelation(p.op.source, p.op.target, p.op.type, p.op.label);
      break;
    case 'updateEntity':
      ws.updateEntity(p.op.entityId, p.op.patch);
      break;
    case 'addTemplate':
      ws.addTemplate(p.op.template);
      break;
  }
}
