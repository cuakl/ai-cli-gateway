import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@aidev/protocol': fileURLToPath(
        new URL('../protocol/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: ['**/test/live/**', '**/node_modules/**', '**/dist/**'],
    testTimeout: 10_000,
    env: {
      GATEWAY_LOG_LEVEL: 'silent',
    },
  },
});
