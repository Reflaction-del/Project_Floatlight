import { defineConfig } from '@playwright/test';

// Electron E2E 测试配置。
// - testDir 指向 e2e/，与 vitest 单元测试（src/**/*.test.ts）互不干扰
// - Electron 应用测试必须串行（workers:1），避免多实例争抢端口 / 用户数据
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  reporter: [['list']],
});
