// ============================================================
// 自然语言创建物料模板（Phase 3 · 功能5）
// ------------------------------------------------------------
// 用户用自然语言描述想要的视觉物料（如「赛博朋克风格的角色通缉令，
// 含照片、悬赏金额、罪名、签名」），调用文本模型生成结构化
// MaterialTemplate（受限 block 子集），结果经提案队列由用户采纳后
// 进入当前世界的用户模板库，可在「视觉物料生成器」中直接使用。
// ============================================================

import { chatOnce, getCurrentModel } from '../../utils/ai';
import type { MaterialTemplate, Block, TemplateCategory } from '../materials/types';

export interface TemplateGenOptions {
  /** 用户指定的类别（可选），否则由模型推断 */
  category?: TemplateCategory;
}

const CATEGORIES: TemplateCategory[] = ['personnel', 'identity', 'daily', 'intel', 'technical', 'narrative'];
const CATEGORY_CN: Record<TemplateCategory, string> = {
  personnel: '人员', identity: '身份', daily: '日常', intel: '情报', technical: '技术', narrative: '叙事',
};

/** 解析模型返回的 JSON（兼容 ```json 代码围栏 / 前后文） */
function parseModelJSON(raw: string): any {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  // 若模型包了一层 { template: {...} }，也能取到
  try {
    const maybe = JSON.parse(s);
    if (maybe && maybe.template && typeof maybe.template === 'object') return maybe.template;
    return maybe;
  } catch {
    return JSON.parse(s);
  }
}

function normCategory(raw: unknown, fallback: TemplateCategory = 'identity'): TemplateCategory {
  if (typeof raw === 'string') {
    const r = raw.trim().toLowerCase();
    if ((CATEGORIES as string[]).includes(r)) return r as TemplateCategory;
    const hit = CATEGORIES.find((c) => CATEGORY_CN[c] === raw.trim());
    if (hit) return hit;
  }
  return fallback;
}

const ALLOWED: string[] = ['text', 'image', 'table', 'divider', 'signature', 'barcode'];

/** 逐一规范化 block，丢弃不支持/缺字段的类型 */
function normBlock(raw: any, i: number): Block | null {
  if (!raw || typeof raw !== 'object') return null;
  const type = typeof raw.type === 'string' ? raw.type : '';
  if (!ALLOWED.includes(type)) return null;
  const id = typeof raw.id === 'string' && raw.id ? raw.id : `b${i}`;
  const base: any = { id, type };
  if (raw.style && typeof raw.style === 'object') base.style = raw.style;

  switch (type) {
    case 'text': {
      const content = typeof raw.content === 'string' ? raw.content : '';
      const role = ['title', 'body', 'label', 'value', 'caption'].includes(raw.role) ? raw.role : undefined;
      const binding = raw.binding && typeof raw.binding === 'object' ? raw.binding : undefined;
      if (!content && !binding) return null;
      return { ...base, type: 'text', content, ...(role ? { role } : {}), ...(binding ? { binding } : {}) };
    }
    case 'image': {
      const binding = raw.binding && typeof raw.binding === 'object' && raw.binding.source
        ? raw.binding
        : { source: 'image', path: 'portrait' };
      return {
        ...base, type: 'image', binding,
        ...(typeof raw.width === 'number' ? { width: raw.width } : {}),
        ...(typeof raw.height === 'number' ? { height: raw.height } : {}),
        ...(typeof raw.round === 'boolean' ? { round: raw.round } : {}),
        ...(typeof raw.placeholder === 'string' ? { placeholder: raw.placeholder } : {}),
      };
    }
    case 'divider':
      return { ...base, type: 'divider' };
    case 'signature':
      return {
        ...base, type: 'signature',
        ...(raw.binding && typeof raw.binding === 'object' ? { binding: raw.binding } : {}),
        ...(typeof raw.label === 'string' ? { label: raw.label } : {}),
      };
    case 'barcode':
      return {
        ...base, type: 'barcode',
        binding: raw.binding && typeof raw.binding === 'object' && raw.binding.source
          ? raw.binding
          : { source: 'customField', path: 'id', fallback: 'ID-000000' },
      };
    case 'table': {
      const columns = Array.isArray(raw.columns)
        ? raw.columns
          .filter((c: any) => c && typeof c.header === 'string' && c.binding && typeof c.binding === 'object')
          .map((c: any, ci: number) => ({ header: c.header, binding: c.binding, ...(c.id ? { id: c.id } : { id: `col${ci}` }) }))
        : [];
      if (columns.length === 0) return null;
      const rows = raw.rows === 'static' || raw.rows === 'entityFields' ? raw.rows : 'customFields';
      const out: any = { ...base, type: 'table', columns, rows };
      if (rows === 'static' && Array.isArray(raw.staticRows)) out.staticRows = raw.staticRows;
      return out;
    }
    default:
      return null;
  }
}

function buildPrompt(userPrompt: string, worldName: string, category?: TemplateCategory): string {
  const catLine = category ? `

注意：本模板类别固定为「${CATEGORY_CN[category]}」。` : '';
  return [
    `你是一个「可视化编辑器」的模板设计师。用户会用自然语言描述一张卡牌 / 海报 / 证件 / 档案的版式与内容，`,
    `请把它转换为一个结构化 JSON 模板，用于虚构世界《${worldName}》的视觉物料渲染。`,
    ``,
    `可用的"块类型"（type 字段必须严格使用以下英文 key，不要使用其它类型）：`,
    `- text：文字。content 支持占位符 {field:name} / {field:type} / {world:worldName} / {customField:键}；也可用 binding 整体绑定。role 可选 title/body/label/value/caption。`,
    `- image：图片。binding 用 {source:"image",path:"portrait"} 绑定实体头像/插图；可设 width/height(像素)、round(布尔)、placeholder(占位文字)。`,
    `- table：表格。columns=[{header,binding}]；rows 用 "customFields"（遍历实体 materialFields）/ "static"（配 staticRows）。`,
    `- divider：分隔线。`,
    `- signature：签名/印章。可设 label（如"签发人"）或 binding 绑定 customField。`,
    `- barcode：条形码。binding 通常用 {source:"customField",path:"id",fallback:"ID-000000"}。`,
    ``,
    `字段来源（binding.source）：entity（name/type/emoji/description）、customField（实体 materialFields 按 key）、world（worldName）、style（logo/accent）、image（portrait/logo）、static（用 static 字段写死文案）。`,
    ``,
    `输出要求：`,
    `1. 一个顶层 JSON 对象，不要任何解释、不要 markdown 代码围栏。结构：`,
    `{"name":"模板名","category":"identity","pageOverride":"A4","blocks":[...]}`,
    `2. category 必须是 personnel/identity/daily/intel/technical/narrative 之一；pageOverride 用 A4/A5/A6/square/id_card/poster 之一（id_card 约名片大小，适合证件）。`,
    `3. blocks 是块数组，每个块必须有 id（唯一字符串）与 type（上述英文 key）。按用户描述合理排布版式（标题在上，图片/字段居中，签名/落款在下）。`,
    `4. 适度使用 {field:*} / {customField:*} 占位符，让模板能套用到任意同类实体；不要写死具体人名（除非是固定 logo 文案）。`,
    `5. 至少包含 3 个块，结构清晰、可渲染。${catLine}`,
    ``,
    `用户需求：`,
    userPrompt,
  ].join('\n');
}

/**
 * 用自然语言生成物料模板。
 * @param userPrompt 自然语言描述
 * @param worldName 当前世界名
 * @param opts 类别预设
 * @param signal 可中断
 */
export async function generateTemplate(
  userPrompt: string,
  worldName: string,
  opts: TemplateGenOptions = {},
  signal?: AbortSignal,
): Promise<MaterialTemplate> {
  const model = getCurrentModel();
  if (!model) {
    throw new Error('未配置文本模型：请打开 设置 → 大模型接入 添加（endpoint / api_key / model）。');
  }
  const prompt = buildPrompt(userPrompt.trim(), worldName, opts.category);
  const raw = (await chatOnce(model, [{ role: 'user', content: prompt }], { signal, feature: 'template-gen' })).trim();
  if (!raw) throw new Error('模型返回为空，请重试。');

  let data: any;
  try {
    data = parseModelJSON(raw);
  } catch {
    throw new Error('模型返回无法解析为 JSON，请重试或换用更强的模型。');
  }

  const name = typeof data?.name === 'string' && data.name.trim() ? data.name.trim() : 'AI 生成模板';
  const category = normCategory(data?.category, opts.category ?? 'identity');

  const blocks: Block[] = Array.isArray(data?.blocks)
    ? (data.blocks.map((b: any, i: number) => normBlock(b, i)).filter((x: Block | null): x is Block => x !== null))
    : [];
  if (blocks.length === 0) throw new Error('模型未生成有效块，请换种描述重试。');

  const pageOverride = typeof data?.pageOverride === 'string' ? (data.pageOverride as MaterialTemplate['pageOverride']) : 'A4';

  return {
    id: `tpl-gen-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    name,
    category,
    applicableStyles: '*',
    pageOverride,
    description: typeof data?.description === 'string' ? data.description : `由自然语言生成：${userPrompt.slice(0, 40)}`,
    blocks,
  };
}
