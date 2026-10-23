import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

export interface NextSemver {
  major: number;
  minor: number;
}

/** Installed `next` version at `root`, or null when it is not resolvable. */
export function readNextVersion(root: string): NextSemver | null {
  try {
    const require = createRequire(path.join(root, 'package.json'));
    const pkgPath = require.resolve('next/package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: unknown };
    if (typeof pkg.version !== 'string') return null;
    const [majorText, minorText] = pkg.version.split('.');
    const major = Number.parseInt(majorText ?? '', 10);
    const minor = Number.parseInt(minorText ?? '', 10);
    if (!Number.isFinite(major) || !Number.isFinite(minor)) return null;
    return { major, minor };
  } catch {
    return null;
  }
}

/**
 * Next 15.3 moved Turbopack config to the top-level `turbopack` key and kept
 * `experimental.turbo` as an alias until Next 16 removed it.
 */
export function supportsExperimentalTurbo(version: NextSemver | null): boolean {
  if (!version) return true;
  return version.major < 16;
}

export function supportsTurbopackRules(version: NextSemver | null): boolean {
  if (!version) return true;
  if (version.major > 15) return true;
  return version.major === 15 && version.minor >= 3;
}
