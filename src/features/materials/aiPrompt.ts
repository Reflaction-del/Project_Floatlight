// ============================================================
// 视觉物料生成器 · AI 头像 prompt 构造（P1）
// ------------------------------------------------------------
// 由实体（name/type/materialFields/custom/note）与风格令牌
// （tone.register → 美术气质、palette → 配色基调）拼装文生图
// prompt，强调单人胸像、无文字、角色一致性。
// 纯函数，便于单测与复用。
// ============================================================

import type { WikiEntity } from '../../types';
import type { StyleToken, ToneRegister } from './types';

const REGISTER_DESC: Record<ToneRegister, string> = {
  formal: '严谨、庄重、机构档案风，对称构图，细节克制',
  playful: '活泼、轻快、可爱，线条圆润',
  cold: '冷峻、疏离、科幻冷感，低饱和',
  absurd: '荒诞、戏谑、超现实，夸张变形',
};

/** 由实体与风格令牌拼装头像生成 prompt（OpenAI 兼容文生图）。 */
export function buildAvatarPrompt(entity: WikiEntity, token: StyleToken): string {
  const parts: string[] = [];
  parts.push('角色头像插画，单人，胸像或半身，正面或四分之三视角，面部清晰，居中构图。');

  const reg = token.tone?.register;
  if (reg) parts.push(`整体美术气质：${REGISTER_DESC[reg]}。`);
  parts.push(`主色调倾向：${token.palette.accent}。`);
  parts.push(`画面质感：${token.palette.ink} 墨色线条，${token.palette.paper} 纸感底。`);

  parts.push(`角色名称：${entity.name}；类型：${entity.type}。`);

  const want = [
    '外貌', 'appearance', '长相',
    '发型', 'hair',
    '服饰', '服装', 'outfit',
    'age', '年龄',
    '性别', 'gender',
    '种族', 'species', 'species',
  ];
  const hints: string[] = [];
  const mf = entity.materialFields ?? {};
  for (const k of want) {
    if (mf[k]) hints.push(`${k}=${mf[k]}`);
  }
  for (const c of entity.custom) {
    if (want.includes(c.label.toLowerCase()) && c.value) hints.push(`${c.label}=${c.value}`);
  }
  if (hints.length) parts.push('角色特征：' + hints.join('；') + '。');

  if (entity.note) parts.push(`背景设定：${entity.note.slice(0, 200)}`);

  parts.push('高质量，细节丰富，无文字，无边框，纯色或透明背景，避免水印与签名。');
  return parts.join(' ');
}

/** 由风格令牌 + 世界观名拼装 Logo 生成 prompt（OpenAI 兼容文生图）。 */
export function buildLogoPrompt(token: StyleToken, worldName: string): string {
  const parts: string[] = [];
  parts.push('一个极简的、可识别的世界观主视觉 Logo 标志，适合置于文档页眉或卡片角落。');
  parts.push(`所属世界观：${worldName}。`);
  parts.push(`主色调：${token.palette.accent}；墨色：${token.palette.ink}；底色倾向：${token.palette.paper}。`);
  parts.push('几何化、对称、负空间克制，无复杂场景，无真实人物。');
  parts.push('纯色背景或透明背景，边缘干净，无文字（避免任何字母/汉字），无边框与水印，矢量感强。');
  return parts.join(' ');
}
