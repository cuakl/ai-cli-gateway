import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const CACHE_MS = 10_000;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

interface CachedListing {
  expiresAt: number;
  files: string[];
}

const listings = new Map<string, CachedListing>();

/** Drop cached `git ls-files` results. Tests call this between repos. */
export function resetFileSearchCache(): void {
  listings.clear();
}

/**
 * Project-relative paths from `git ls-files --cached --others --exclude-standard`,
 * filtered and ranked by a case-insensitive subsequence of `query`.
 * Basename matches sort before path-only matches. Default limit 20, max 50.
 */
export async function searchProjectFiles(root: string, query: string, limit?: number): Promise<string[]> {
  const cap = Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const files = await listProjectFiles(root);
  return rankFiles(files, query, cap);
}

export function rankFiles(files: string[], query: string, limit: number): string[] {
  const needle = query.trim();
  if (!needle) return files.slice(0, limit);
  const scored: { file: string; score: number }[] = [];
  for (const file of files) {
    const score = rankFile(file, needle);
    if (score === null) continue;
    scored.push({ file, score });
  }
  scored.sort((left, right) => right.score - left.score || left.file.localeCompare(right.file));
  return scored.slice(0, limit).map((entry) => entry.file);
}

async function listProjectFiles(root: string): Promise<string[]> {
  const now = Date.now();
  const cached = listings.get(root);
  if (cached && cached.expiresAt > now) return cached.files;
  const files = await gitLsFiles(root);
  listings.set(root, { files, expiresAt: now + CACHE_MS });
  return files;
}

async function gitLsFiles(root: string): Promise<string[]> {
  try {
    const { stdout } = await exec('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout
      .split('\n')
      .map((line) => line.replaceAll('\\', '/').trim())
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}

function rankFile(file: string, query: string): number | null {
  const normalized = file.replaceAll('\\', '/');
  const slash = normalized.lastIndexOf('/');
  const base = slash === -1 ? normalized : normalized.slice(slash + 1);
  const baseHits = subsequence(base, query);
  const pathHits = subsequence(normalized, query);
  if (!baseHits && !pathHits) return null;
  const hits = baseHits ?? pathHits ?? [];
  const targetLen = baseHits ? base.length : normalized.length;
  const first = hits[0] ?? 0;
  const span = hits.length === 0 ? 0 : (hits[hits.length - 1] ?? 0) - first;
  let score = baseHits ? 1_000_000 : 0;
  score -= first * 100;
  score -= span * 10;
  score -= targetLen;
  return score;
}

/** Indexes of a case-insensitive subsequence, or null if `needle` is not a subsequence. */
function subsequence(haystack: string, needle: string): number[] | null {
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  if (n.length === 0) return [];
  const hits: number[] = [];
  let from = 0;
  for (const ch of n) {
    const at = h.indexOf(ch, from);
    if (at === -1) return null;
    hits.push(at);
    from = at + 1;
  }
  return hits;
}
