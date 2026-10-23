import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@aidev/protocol': fileURLToPath(new URL('../protocol/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['test/live/**/*.live.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    fileParallelism: false,
    testTimeout: 420_000,
    hookTimeout: 120_000,
    sequence: { concurrent: false },
    env: {
      GATEWAY_LOG_LEVEL: 'silent',
    },
  },
});
