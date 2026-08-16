// ============================================================
// utils/versionBump.ts 纯函数单元测试
// 守护 bump 脚本（scripts/bump-version.mjs 内联副本）的「真源」逻辑：
//  - parseVersion / validateVersionString：版本解析与格式校验
//  - computeVersionCode：Android versionCode 编码（含 KNOWN LIMITATION 回归标记）
//  - isVersionHigher / validateNewVersion：升版校验（防降级/手滑）
//  - replaceVersionInContent：文档版本串替换（边界保护）
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  parseVersion,
  validateVersionString,
  computeVersionCode,
  isVersionHigher,
  validateNewVersion,
  replaceVersionInContent,
} from './versionBump';

describe('parseVersion', () => {
  it('标准 semver 解析为三元组', () => {
    expect(parseVersion('2.2.9')).toEqual([2, 2, 9]);
  });

  it('含零号段', () => {
    expect(parseVersion('2.0.0')).toEqual([2, 0, 0]);
  });

  it('大号段（minor 跨 10）', () => {
    expect(parseVersion('2.10.3')).toEqual([2, 10, 3]);
  });

  it('两段格式抛错', () => {
    expect(() => parseVersion('2.2')).toThrow();
  });

  it('四段格式抛错', () => {
    expect(() => parseVersion('2.2.9.1')).toThrow();
  });

  it('非数字段抛错', () => {
    expect(() => parseVersion('2.x.9')).toThrow();
  });

  it('负数段抛错', () => {
    expect(() => parseVersion('2.-1.9')).toThrow();
  });
});

describe('validateVersionString', () => {
  it('合法版本为 true', () => {
    expect(validateVersionString('2.2.9')).toBe(true);
  });

  it('两段为 false', () => {
    expect(validateVersionString('2.2')).toBe(false);
  });

  it('非数字为 false', () => {
    expect(validateVersionString('2.2.x')).toBe(false);
  });

  it('空串为 false', () => {
    expect(validateVersionString('')).toBe(false);
  });

  it('带 v 前缀为 false', () => {
    expect(validateVersionString('v2.2.9')).toBe(false);
  });
});

describe('computeVersionCode', () => {
  it('基线 2.2.8 → 20228', () => {
    expect(computeVersionCode('2.2.8')).toBe(20228);
  });

  it('当前 2.2.9 → 20229', () => {
    expect(computeVersionCode('2.2.9')).toBe(20229);
  });

  it('minor 跨 10：2.10.3 → 202103', () => {
    expect(computeVersionCode('2.10.3')).toBe(202103);
  });

  it('minor 晋升：2.3.0 → 20230', () => {
    expect(computeVersionCode('2.3.0')).toBe(20230);
  });

  it('patch 跨 10：2.2.99 → 202299', () => {
    expect(computeVersionCode('2.2.99')).toBe(202299);
  });

  it('KNOWN LIMITATION: 2.3.0 的 versionCode < 2.2.99（跨 10 非单调）', () => {
    // 此用例验证已知缺陷：patch 跨 10 后再升 minor，versionCode 反而变小。
    // Android 以 versionCode 判定升级方向，此时无法升级。
    // 进入 2.2.10+/2.3.x 规划前需改用 major*10000+minor*100+patch 并一次性跳高。
    expect(computeVersionCode('2.3.0')).toBeLessThan(computeVersionCode('2.2.99'));
  });
});

describe('isVersionHigher', () => {
  it('patch 递增为 true', () => {
    expect(isVersionHigher('2.2.8', '2.2.9')).toBe(true);
  });

  it('逆向为 false', () => {
    expect(isVersionHigher('2.2.9', '2.2.8')).toBe(false);
  });

  it('相等为 false', () => {
    expect(isVersionHigher('2.2.9', '2.2.9')).toBe(false);
  });

  it('minor 递增为 true', () => {
    expect(isVersionHigher('2.2.9', '2.3.0')).toBe(true);
  });

  it('major 递增为 true', () => {
    expect(isVersionHigher('2.2.9', '3.0.0')).toBe(true);
  });

  it('patch 跨 10 为 true', () => {
    expect(isVersionHigher('2.10.0', '2.10.1')).toBe(true);
  });

  it('minor 跨 10 为 true', () => {
    expect(isVersionHigher('2.9.9', '2.10.0')).toBe(true);
  });
});

describe('validateNewVersion', () => {
  it('正常升版 ok', () => {
    expect(validateNewVersion('2.2.9', '2.3.0')).toEqual({ ok: true });
  });

  it('同版本不 ok', () => {
    const r = validateNewVersion('2.2.9', '2.2.9');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('higher');
  });

  it('降版不 ok', () => {
    const r = validateNewVersion('2.2.9', '2.2.8');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('higher');
  });

  it('非法格式不 ok', () => {
    const r = validateNewVersion('2.2.9', 'invalid');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Invalid version format');
  });

  it('缺一段不 ok', () => {
    const r = validateNewVersion('2.2.9', '2.2');
    expect(r.ok).toBe(false);
  });
});

describe('replaceVersionInContent', () => {
  it('基本替换', () => {
    expect(replaceVersionInContent('v2.2.8', '2.2.8', '2.2.9')).toBe('v2.2.9');
  });

  it('文件名替换', () => {
    expect(replaceVersionInContent('浮光世界观编辑器_v2.2.8_Setup.exe', '2.2.8', '2.2.9')).toBe('浮光世界观编辑器_v2.2.9_Setup.exe');
  });

  it('多次出现全部替换', () => {
    expect(replaceVersionInContent('v2.2.8 and v2.2.8', '2.2.8', '2.2.9')).toBe('v2.2.9 and v2.2.9');
  });

  it('无匹配保持不变', () => {
    expect(replaceVersionInContent('no version here', '2.2.8', '2.2.9')).toBe('no version here');
  });

  it('边界：不误匹配后缀数字（v2.2.80）', () => {
    expect(replaceVersionInContent('v2.2.80', '2.2.8', '2.2.9')).toBe('v2.2.80');
  });

  it('边界：不误匹配前缀数字（12.2.8）', () => {
    expect(replaceVersionInContent('12.2.8', '2.2.8', '2.2.9')).toBe('12.2.8');
  });

  it('HTML span 替换', () => {
    expect(replaceVersionInContent('<span>v2.2.8</span>', '2.2.8', '2.2.9')).toBe('<span>v2.2.9</span>');
  });

  it('build.gradle versionName 替换', () => {
    expect(replaceVersionInContent('versionName "2.2.9"', '2.2.9', '2.3.0')).toBe('versionName "2.3.0"');
  });
});
