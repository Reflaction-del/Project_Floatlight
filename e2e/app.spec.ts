import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

// Electron E2E 冒烟测试：验证桌面应用能启动、主窗口渲染出核心 UI。
// 运行前置：先 `npm run build`（主进程经内嵌 HTTP 服务器从 dist/ 加载前端）。

test('应用启动并渲染主界面', async ({}, testInfo) => {
  // 隔离用户数据目录，避免污染真实数据（boot 快照 / AI Key / bridge 配置）
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'floatlight-e2e-'));

  // 关键：宿主环境可能注入 ELECTRON_RUN_AS_NODE / NODE_OPTIONS（如本机 WorkBuddy），
  // 会导致 electron.exe 以纯 Node 模式运行：require('electron') 返回路径字符串、
  // --remote-debugging-port 被当成非法参数，最终报 "Process failed to launch!"。
  // 必须显式剥离后再启动。
  const { ELECTRON_RUN_AS_NODE: _runAsNode, NODE_OPTIONS: _nodeOptions, ...baseEnv } = process.env;

  const app = await electron.launch({
    args: ['.'],
    cwd: process.cwd(),
    env: {
      ...baseEnv,
      FLOATLIGHT_USER_DATA: userDataDir,
      FLOATLIGHT_E2E: '1',
    },
  });

  const page = await app.firstWindow();

  // 1) 窗口标题（产品名）
  await expect(page).toHaveTitle(/浮光/);

  // 2) 核心工具栏「实体库」按钮出现 → React 已挂载、三栏布局已渲染
  await expect(page.locator('button[title="实体库"]')).toBeVisible();

  // 3) 截图留档（输出到 test-results/<用例名>/）
  await page.screenshot({ path: testInfo.outputPath('app-home.png') });

  await app.close();
});
