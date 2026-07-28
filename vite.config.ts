import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // 临时：避免 vite 清空 dist 触发沙箱批量删除拦截；构建后改回 true
    emptyOutDir: false,
  },
  server: {
    host: true,
    port: 5173,
  },
});
