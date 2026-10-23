import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

/**
 * Directory of the built dashboard SPA (`index.html` + assets).
 * Resolved through the `@aidev/dashboard/index.html` export when that package
 * is installed, otherwise the sibling workspace build.
 */
export function resolveDashboardDist(): string {
  try {
    return path.dirname(require.resolve('@aidev/dashboard/index.html'));
  } catch {
    return fileURLToPath(new URL('../../dashboard/dist', import.meta.url));
  }
}
