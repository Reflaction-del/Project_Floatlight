import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

// 构建时读取 package.json version（readFileSync+JSON.parse 而非 ESM import，
// 避免 ESM JSON import assertion 在不同 Node 版本的兼容性问题）
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

// 构建时取 commit 短值；git 不可用（如 CI 无 git 环境）时回退 'unknown'
let appCommit = 'unknown';
try {
  appCommit = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
} catch {
  // git 不可用，保持 'unknown'
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    // 值须 JSON.stringify 包裹，define 是表达式替换，裸值会生成非法标识符
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify(appCommit),
  },
  build: {
    // 每次构建清空 dist，避免残留旧产物（原 emptyOutDir:false 为规避沙箱批量删除拦截的临时 hack，已可改回）
    emptyOutDir: true,
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
