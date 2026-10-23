import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Library mode externalizes dependencies unless a later hook forces them in.
 * The overlay script has to run from a single file with no import map.
 */
function bundleDependencies(): Plugin {
  return {
    name: 'ai-devtools-bundle-dependencies',
    apply: 'build',
    enforce: 'post',
    options(options) {
      return {
        ...options,
        external: () => false,
      };
    },
  };
}

export default defineConfig(({ mode }) => {
  const iife = mode === 'iife';
  return {
    plugins: [bundleDependencies()],
    esbuild: {
      jsx: 'automatic',
      jsxImportSource: 'preact',
    },
    resolve: {
      alias: {
        '@aidev/protocol': fileURLToPath(
          new URL('../protocol/src/index.ts', import.meta.url),
        ),
        'node:crypto': fileURLToPath(new URL('./src/shims/crypto.ts', import.meta.url)),
      },
    },
    test: {
      environment: 'happy-dom',
      include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
      restoreMocks: true,
      testTimeout: 10_000,
    },
    build: {
      emptyOutDir: !iife,
      sourcemap: true,
      minify: iife,
      cssCodeSplit: false,
      lib: iife
        ? {
            entry: fileURLToPath(new URL('./src/auto.ts', import.meta.url)),
            name: 'AiDevtools',
            formats: ['iife'],
            fileName: () => 'overlay.js',
          }
        : {
            entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
            formats: ['es'],
            fileName: () => 'index.js',
          },
      rollupOptions: {
        external: [],
        output: {
          inlineDynamicImports: true,
        },
      },
    },
  };
});
