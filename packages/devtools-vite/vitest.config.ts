import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@gateway/shared-types': fileURLToPath(new URL('../shared-types/src/index.ts', import.meta.url)),
      '@gateway/core': fileURLToPath(new URL('../gateway-core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 20_000,
    env: {
      GATEWAY_LOG_LEVEL: 'silent',
    },
  },
});
