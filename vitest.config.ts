import { defineConfig } from 'vitest/config';

// 单元测试配置：node 环境（不加载 DOM/Electron），只测纯函数与 store 逻辑。
// 测试文件约定：src/**/*.test.ts（与源码同目录，便于就近维护）。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: false,
  },
});
