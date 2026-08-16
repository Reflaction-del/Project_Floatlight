#!/usr/bin/env node
// ============================================================
// 版本号 bump 脚本：npm run version:bump -- <新版本>
// 例：npm run version:bump -- 2.3.0
//
// 一处改、处处改：以 package.json 的 version 为真相源，自动同步
//   - android/app/build.gradle 的 versionName + versionCode
//   - README.md / AGENTS.md / docs/preview-*.html 中的版本串
// 不自动 commit——跑完人工 git add && git commit。
//
// 下方纯函数为 src/utils/versionBump.ts 的内联副本（vitest 守护真源），
// 改逻辑须两侧同步。
// ============================================================

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ---- 纯函数（Keep in sync with src/utils/versionBump.ts）----

function parseVersion(v) {
  const parts = v.split('.');
  if (parts.length !== 3) throw new Error(`Invalid version: ${v}`);
  const nums = parts.map((p) => {
    if (!/^\d+$/.test(p)) throw new Error(`Invalid version: ${v}`);
    return Number(p);
  });
  return [nums[0], nums[1], nums[2]];
}

function validateVersionString(v) {
  return /^\d+\.\d+\.\d+$/.test(v);
}

function computeVersionCode(v) {
  const [major, minor, patch] = parseVersion(v);
  return parseInt(`20${major}${minor}${patch}`, 10);
}

function isVersionHigher(current, next) {
  const a = parseVersion(current);
  const b = parseVersion(next);
  for (let i = 0; i < 3; i++) {
    if (b[i] > a[i]) return true;
    if (b[i] < a[i]) return false;
  }
  return false;
}

function validateNewVersion(current, next) {
  if (!validateVersionString(next)) {
    return { ok: false, error: `Invalid version format: ${next}（应为 X.Y.Z）` };
  }
  if (!isVersionHigher(current, next)) {
    return { ok: false, error: `New version must be higher than current (current: ${current}, next: ${next})` };
  }
  return { ok: true };
}

function replaceVersionInContent(content, oldVersion, newVersion) {
  const escaped = oldVersion.replace(/\./g, '\\.');
  const pattern = new RegExp(`(?<![0-9.])${escaped}(?![0-9])`, 'g');
  return content.replace(pattern, newVersion);
}

// ---- 路径与文件清单 ----

const root = fileURLToPath(new URL('..', import.meta.url));
const pkgPath = `${root}package.json`;
const gradlePath = `${root}android/app/build.gradle`;
const docFiles = [
  'README.md',
  'AGENTS.md',
  'docs/preview-glass.html',
  'docs/preview-minimal.html',
].map((f) => `${root}${f}`);

// ---- 主流程 ----

const newVersion = process.argv[2];
if (!newVersion) {
  console.error('用法：npm run version:bump -- <新版本>   例：npm run version:bump -- 2.3.0');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
const currentVersion = pkg.version;

const check = validateNewVersion(currentVersion, newVersion);
if (!check.ok) {
  console.error(`✗ ${check.error}`);
  process.exit(1);
}

// 1. package.json：JSON 操作（不碰 artifactName 里的 ${version} 宏）
pkg.version = newVersion;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

// 2. android/app/build.gradle：versionCode + versionName
const newCode = computeVersionCode(newVersion);
let gradle = readFileSync(gradlePath, 'utf-8');
gradle = gradle.replace(/versionCode \d+/, `versionCode ${newCode}`);
gradle = gradle.replace(/versionName "[^"]*"/, `versionName "${newVersion}"`);
writeFileSync(gradlePath, gradle);

// 3. 文档版本串替换
for (const f of docFiles) {
  const content = readFileSync(f, 'utf-8');
  const next = replaceVersionInContent(content, currentVersion, newVersion);
  if (next !== content) writeFileSync(f, next);
}

// 4. 结果提示（不自动 commit，人工把关）
console.log(`✓ Version bumped: ${currentVersion} → ${newVersion}`);
console.log('  Modified files:');
console.log('    package.json');
console.log('    android/app/build.gradle');
console.log('    README.md / AGENTS.md / docs/preview-*.html');
console.log('');
console.log('请人工审查后提交：');
console.log('  git add -A && git commit -m "chore: 版本号升至 ' + newVersion + '"');
