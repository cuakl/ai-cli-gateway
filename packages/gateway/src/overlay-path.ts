import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

/**
 * Absolute path of the built overlay IIFE.
 * Resolved through the `@aidev/overlay/overlay.js` package export when that
 * package is installed, otherwise the sibling workspace build.
 */
export function resolveOverlayBundle(): string {
  try {
    return require.resolve('@aidev/overlay/overlay.js');
  } catch {
    return fileURLToPath(new URL('../../overlay/dist/overlay.js', import.meta.url));
  }
}
