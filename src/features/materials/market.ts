// ============================================================
// 视觉物料生成器 · 模板/风格市场（P3-D）
// ------------------------------------------------------------
// 纯本地、零在线依赖的分发单元：把模板 / 风格打包成带「信封」的
// JSON 文件（.fugutemplate / .fuguxystyle），可导出分享、可导入落库。
// 与产品离线优先架构一致——没有任何网络请求。
// ============================================================

import type { MaterialTemplate, MaterialStyle } from './types';

/** 文件格式标识（信封 format 字段），导入时据此路由到模板或风格 */
export const FUGU_TEMPLATE_FORMAT = 'fugu.template';
export const FUGU_STYLE_FORMAT = 'fugu.style';

/** 文件扩展名（导出下载用） */
export const FUGU_TEMPLATE_EXT = '.fugutemplate';
export const FUGU_STYLE_EXT = '.fuguestyle';

export interface FuguTemplateFile {
  format: typeof FUGU_TEMPLATE_FORMAT;
  version: number;
  payload: MaterialTemplate;
}
export interface FuguStyleFile {
  format: typeof FUGU_STYLE_FORMAT;
  version: number;
  payload: MaterialStyle;
}
export type FuguFile = FuguTemplateFile | FuguStyleFile;

/** 把模板打包成可分享的文件文本 */
export function buildTemplateFile(tpl: MaterialTemplate): string {
  const file: FuguTemplateFile = { format: FUGU_TEMPLATE_FORMAT, version: 1, payload: tpl };
  return JSON.stringify(file, null, 2);
}

/** 把风格打包成可分享的文件文本 */
export function buildStyleFile(style: MaterialStyle): string {
  const file: FuguStyleFile = { format: FUGU_STYLE_FORMAT, version: 1, payload: style };
  return JSON.stringify(file, null, 2);
}

export type ParseResult =
  | { ok: true; kind: 'template'; payload: MaterialTemplate }
  | { ok: true; kind: 'style'; payload: MaterialStyle }
  | { ok: false; error: string };

/**
 * 解析导入的 .fugu* 文件文本。
 * 防御式解析：任何不合法输入都返回 { ok:false, error }，绝不抛出，
 * 由调用方以温和提示呈现（用户主动选择的本地文件，仍按不可信输入处理）。
 */
export function parseFuguFile(text: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: '文件不是合法的 JSON，无法解析' };
  }
  if (!data || typeof data !== 'object') {
    return { ok: false, error: '文件内容无法识别' };
  }
  const obj = data as Record<string, unknown>;

  if (obj.format === FUGU_TEMPLATE_FORMAT) {
    const payload = obj.payload as MaterialTemplate | undefined;
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.blocks)) {
      return { ok: false, error: '模板文件缺少 blocks 字段或结构不正确' };
    }
    if (typeof payload.id !== 'string' || typeof payload.name !== 'string') {
      return { ok: false, error: '模板文件缺少 id / name' };
    }
    return { ok: true, kind: 'template', payload };
  }

  if (obj.format === FUGU_STYLE_FORMAT) {
    const payload = obj.payload as MaterialStyle | undefined;
    if (!payload || typeof payload !== 'object' || !payload.token) {
      return { ok: false, error: '风格文件缺少 token 字段或结构不正确' };
    }
    if (typeof payload.name !== 'string') {
      return { ok: false, error: '风格文件缺少 name' };
    }
    return { ok: true, kind: 'style', payload };
  }

  return { ok: false, error: `未知文件格式：${String(obj.format ?? '空')}（需 .fugutemplate 或 .fuguxystyle）` };
}

/** 触发浏览器/渲染进程下载一个文本文件（纯前端，无 IPC 依赖） */
export function downloadTextFile(filename: string, text: string, mime = 'application/json') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 为导入的模板生成不与本地冲突的新 id */
export function freshTemplateId(): string {
  return `tpl-imp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
