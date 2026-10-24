import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Library mode externalizes dependencies unless a later hook forces them in.
 * The overlay app has to run in the browser with no import map.
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

function overlayManualChunks(id: string): string | undefined {
  const normalized = id.replace(/\\/g, '/');
  if (normalized.includes('/node_modules/@xterm/') || normalized.includes('/node_modules/xterm')) {
    return 'xterm';
  }
  if (normalized.includes('/node_modules/html-to-image/')) return 'html-to-image';
  return undefined;
}

export default defineConfig(({ mode }) => {
  const loader = mode === 'loader';
  if (loader) {
    return {
      plugins: [],
      build: {
        emptyOutDir: false,
        sourcemap: true,
        minify: true,
        lib: {
          entry: fileURLToPath(new URL('./src/loader.ts', import.meta.url)),
          name: 'AiDevtoolsLoader',
          formats: ['iife'],
          fileName: () => 'overlay.js',
        },
        rollupOptions: {
          output: {
            inlineDynamicImports: true,
          },
        },
      },
    };
  }

  return {
    plugins: [bundleDependencies()],
    esbuild: {
      jsx: 'automatic',
      jsxImportSource: 'preact',
    },
    resolve: {
      alias: {
        '@aidev/protocol': fileURLToPath(new URL('../protocol/src/index.ts', import.meta.url)),
        'node:crypto': fileURLToPath(new URL('./src/shims/crypto.ts', import.meta.url)),
      },
    },
    test: {
      environment: 'happy-dom',
      include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
      restoreMocks: true,
      setupFiles: ['test/setup.ts'],
      testTimeout: 10_000,
    },
    build: {
      emptyOutDir: true,
      sourcemap: true,
      minify: true,
      cssCodeSplit: true,
      lib: {
        entry: {
          app: fileURLToPath(new URL('./src/auto.ts', import.meta.url)),
        },
        formats: ['es'],
      },
      rollupOptions: {
        external: [],
        preserveEntrySignatures: false,
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: '[name].js',
          assetFileNames: '[name][extname]',
          manualChunks: overlayManualChunks,
        },
      },
    },
  };
});
