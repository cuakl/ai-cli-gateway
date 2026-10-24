import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/dashboard/',
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'preact',
  },
  resolve: {
    alias: {
      '@aidev/protocol': fileURLToPath(new URL('../protocol/src/index.ts', import.meta.url)),
      '@aidev/overlay/chat': fileURLToPath(new URL('../overlay/src/chat.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    restoreMocks: true,
    setupFiles: ['test/setup.ts'],
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    emptyOutDir: true,
    cssCodeSplit: false,
  },
});
