import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // 临时：避免 vite 清空 dist 触发沙箱批量删除拦截；构建后改回 true
    emptyOutDir: false,
    rollupOptions: {
      output: {
        // 拆 vendor：tiptap/prosemirror、katex、marked、react 各自独立 chunk，
        // 与既有视图懒加载配合，避免 index 主包 >500kB。
        // 注意：zustand 归入 vendor（其依赖 react，放 react-vendor 会形成 chunk 循环）
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@tiptap') || id.includes('prosemirror')) return 'tiptap';
          if (id.includes('katex')) return 'katex';
          if (id.includes('marked')) return 'marked';
          if (id.includes('react') || id.includes('scheduler')) return 'react-vendor';
          return 'vendor';
        },
      },
    },
  },
  server: {
    host: true,
    port: 5173,
  },
});
