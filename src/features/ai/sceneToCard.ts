// ============================================================
// 多模态设卡抽取（Phase 2 · 功能2）
// ------------------------------------------------------------
// 给定一张图片（实体立绘 / 场景图 / 概念图）与可选文字提示，
// 调用支持视觉的 OpenAI 兼容模型（gpt-4o / qwen-vl 等）识别其中的
// 实体信息，输出结构化「设卡」数据（名称 / 类别 / 属性 / 格言 / 编号 /
// 图注）。结果由调用方转为「提案」进入统一提案队列（不直接落库）。
// ============================================================

import { chatVision, getCurrentModel } from '../../utils/ai';
import type { EntityType } from '../../types';

export interface SceneCardResult {
  /** 实体名 */
  name: string;
  /** 实体类型（英文 key） */
  type: EntityType;
  /** 一句话中文设定 / 简介（≤60 字） */
  description: string;
  /** 有世界观味道的属性键值对（3~6 条） */
  materialFields: Record<string, string>;
  /** 身份格言 / 标语（≤20 字，可选） */
  motto?: string;
  /** 建议编号（如 "ID-2024-001"） */
  serial?: string;
  /** 对图片本身的简短中文描述（≤30 字），用于卡片图注 */
  caption?: string;
}

export interface SceneCardOpts {
  /** 用户补充的文字说明 / 世界观背景 */
  hint?: string;
  /** 类别预设（用户已知该图对应哪类实体时） */
  typeHint?: EntityType;
}

const ENTITY_TYPES: EntityType[] = ['character', 'faction', 'location', 'event', 'rule'];
const TYPE_CN: Record<EntityType, string> = {
  character: '角色', faction: '势力', location: '地点', event: '事件', rule: '规则',
};

function normalizeType(raw: unknown, fallback: EntityType = 'character'): EntityType {
  if (typeof raw === 'string') {
    const r = raw.trim().toLowerCase();
    if ((ENTITY_TYPES as string[]).includes(r)) return r as EntityType;
    const hit = ENTITY_TYPES.find((t) => TYPE_CN[t] === raw.trim());
    if (hit) return hit;
  }
  return fallback;
}

/** 解析模型返回的 JSON（兼容 ```json 代码围栏 / 多余前后文） */
function parseModelJSON(raw: string): any {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  return JSON.parse(s);
}

function buildPrompt(worldName: string, opts: SceneCardOpts): string {
  const typeHint = opts.typeHint ? `（提示：这张图大概率属于「${TYPE_CN[opts.typeHint]}」类实体，但最终以图为准）` : '';
  const hintLine = opts.hint?.trim() ? `\n补充背景：${opts.hint.trim()}` : '';
  return [
    `你是一个世界观视觉设卡助手。请分析下面这张图片（可能是角色立绘、场景图、徽记、概念图等），`,
    `为《${worldName}》这个世界观生成一份结构化「设卡」信息。${typeHint}${hintLine}`,
    '',
    `实体类别（type 字段必须严格使用以下英文 key）：`,
    `character=角色, faction=势力, location=地点, event=事件, rule=规则。`,
    '',
    `要求：`,
    `1. 仔细观察图片的视觉要素（人物 / 服饰 / 徽记 / 环境 / 色调 / 文字等），结合常识推断设定，但不得编造图中不存在的专有名词。`,
    `2. name 为实体名（中文优先；图中如有文字可直接采用）；type 用上述英文 key。`,
    `3. description 为一句话中文设定 / 简介，≤60 字。`,
    `4. materialFields 为一个对象，包含 3~6 条有世界观味道的属性键值对（键与值均用中文，如 「阵营」「身份」「性格」「能力」「年代」「出处」等，按识别出的类别灵活调整，不要机械套用）。`,
    `5. motto 为可选的一句身份格言 / 标语，≤20 字；serial 为建议编号（形如 "ID-2024-001"）；caption 为对图片本身的简短中文描述（≤30 字），用于卡片图注。`,
    `6. 只输出一个 JSON 对象，不要任何解释、不要 markdown 代码围栏。结构：`,
    `{"name":"","type":"character","description":"","materialFields":{"阵营":"","身份":""},"motto":"","serial":"ID-000000","caption":""}`,
  ].join('\n');
}

/**
 * 从一张图片抽取实体设卡信息。
 * @param imageDataUrl 图片 dataURL
 * @param worldName 当前世界名（语境提示）
 * @param opts 文字提示 / 类别预设
 * @param signal 可中断
 */
export async function sceneToCard(
  imageDataUrl: string,
  worldName: string,
  opts: SceneCardOpts = {},
  signal?: AbortSignal,
): Promise<SceneCardResult> {
  const model = getCurrentModel();
  if (!model) {
    throw new Error('未配置视觉模型：请打开 设置 → 大模型接入 添加支持视觉的模型（endpoint / api_key / model），并将格式设为 chat。');
  }
  if (!model.supportsVision) {
    throw new Error('当前模型未标记支持视觉。请在「设置 → 大模型接入」中勾选该模型的「支持视觉输入」，并确认模型格式为 chat。');
  }
  const prompt = buildPrompt(worldName, opts);
  const raw = (await chatVision(model, prompt, [imageDataUrl], { signal, feature: 'scene-card' })).trim();
  if (!raw) throw new Error('模型返回为空，请重试。');

  let data: any;
  try {
    data = parseModelJSON(raw);
  } catch {
    throw new Error('模型返回无法解析为 JSON，请重试或换用更强的视觉模型。');
  }

  const name = typeof data?.name === 'string' ? data.name.trim() : '';
  if (!name) throw new Error('模型未返回实体名，请重试。');

  const type = normalizeType(data.type, opts.typeHint ?? 'character');

  const materialFields: Record<string, string> = {};
  if (data?.materialFields && typeof data.materialFields === 'object') {
    for (const [k, v] of Object.entries(data.materialFields)) {
      if (typeof k === 'string' && typeof v === 'string' && k.trim()) {
        materialFields[k.trim()] = v;
      }
    }
  }

  return {
    name,
    type,
    description: typeof data?.description === 'string' ? data.description.trim() : '',
    materialFields,
    motto: typeof data?.motto === 'string' && data.motto.trim() ? data.motto.trim() : undefined,
    serial: typeof data?.serial === 'string' && data.serial.trim() ? data.serial.trim() : undefined,
    caption: typeof data?.caption === 'string' ? data.caption.trim() : undefined,
  };
}
