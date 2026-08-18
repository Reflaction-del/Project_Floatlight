// ============================================================
// utils/versionBump.ts 版本号管理纯函数（bump 脚本的「真源」）
// 供 scripts/bump-version.mjs 内联副本参考（改此处须同步改脚本内联副本）。
// 覆盖：版本解析/校验/比较、文档版本串替换。
// ============================================================

export type VersionTuple = [number, number, number];

/** 解析 "X.Y.Z" → [major, minor, patch]；格式不合法抛 Error */
export function parseVersion(v: string): VersionTuple {
  const parts = v.split('.');
  if (parts.length !== 3) throw new Error(`Invalid version: ${v}`);
  const nums = parts.map((p) => {
    if (!/^\d+$/.test(p)) throw new Error(`Invalid version: ${v}`);
    return Number(p);
  });
  return [nums[0], nums[1], nums[2]];
}

/** 校验字符串是否为合法 "X.Y.Z"（三段非负整数） */
export function validateVersionString(v: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(v);
}

/** 语义比较：next 是否严格高于 current（逐位比较 major → minor → patch） */
export function isVersionHigher(current: string, next: string): boolean {
  const a = parseVersion(current);
  const b = parseVersion(next);
  for (let i = 0; i < 3; i++) {
    if (b[i] > a[i]) return true;
    if (b[i] < a[i]) return false;
  }
  return false;
}

/** 综合校验：新版本合法且严格高于当前版本 */
export function validateNewVersion(
  current: string,
  next: string,
): { ok: boolean; error?: string } {
  if (!validateVersionString(next)) {
    return { ok: false, error: `Invalid version format: ${next}（应为 X.Y.Z）` };
  }
  if (!isVersionHigher(current, next)) {
    return { ok: false, error: `New version must be higher than current (current: ${current}, next: ${next})` };
  }
  return { ok: true };
}

/**
 * 在文件内容中把 oldVersion 替换为 newVersion。
 * 负向 lookbehind/lookahead 边界保护，避免 "2.2.8" 误匹配 "2.2.80" 或 "12.2.8"。
 */
export function replaceVersionInContent(
  content: string,
  oldVersion: string,
  newVersion: string,
): string {
  const escaped = oldVersion.replace(/\./g, '\\.');
  const pattern = new RegExp(`(?<![0-9.])${escaped}(?![0-9])`, 'g');
  return content.replace(pattern, newVersion);
}
