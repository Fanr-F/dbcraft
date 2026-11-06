import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

const sharedAlias = {
  '@shared': resolve('src/shared'),
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: sharedAlias },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'sqlite-worker': resolve('src/main/workers/sqlite-worker.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: sharedAlias },
  },
  renderer: {
    resolve: {
      alias: {
        ...sharedAlias,
        '@renderer': resolve('src/renderer/src'),
      },
    },
    // Stencil 组件（RevoGrid）自带懒加载入口；交给 Vite 预打包会拆错运行时，
    // 开发模式表现为 <revo-grid> 已挂载但内容为空。
    optimizeDeps: {
      exclude: ['@revolist/react-datagrid', '@revolist/revogrid'],
    },
    plugins: [react()],
  },
});
