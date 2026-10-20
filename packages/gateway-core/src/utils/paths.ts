import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

export class PathEscapeError extends Error {
  readonly code = 'path_escape' as const;

  constructor(message: string) {
    super(message);
    this.name = 'PathEscapeError';
  }
}

/**
 * Resolve `target` (absolute, or relative to `base`) and require the result
 * to stay inside `root`. Missing leaves are allowed when every existing
 * ancestor is still inside the root. Symlinks are resolved before the check.
 */
export async function confineToRoot(root: string, target: string, base?: string): Promise<string> {
  if (!target.trim() || target.includes('\0')) {
    throw new PathEscapeError('Path is empty');
  }
  const rootResolved = path.resolve(root);
  const absolute = path.resolve(base ?? rootResolved, target);
  const rootReal = await canonicalize(rootResolved);
  const targetReal = await canonicalize(absolute);
  if (!isInsideRoot(rootReal, targetReal)) {
    throw new PathEscapeError(`Path escapes the project root: ${target}`);
  }
  return targetReal;
}

/**
 * Require `cwd` to be an existing directory inside `root`, and each file to
 * stay inside that same root. Returned paths are absolute.
 */
export async function confineWorkspace(
  root: string,
  cwd: string,
  files: string[] = [],
): Promise<{ cwd: string; files: string[] }> {
  const confinedCwd = await confineToRoot(root, cwd);
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(confinedCwd);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new PathEscapeError(`cwd does not exist: ${cwd}`);
    }
    throw error;
  }
  if (!info.isDirectory()) {
    throw new PathEscapeError(`cwd is not a directory: ${cwd}`);
  }
  const confinedFiles: string[] = [];
  for (const file of files) {
    confinedFiles.push(await confineToRoot(root, file, confinedCwd));
  }
  return { cwd: confinedCwd, files: confinedFiles };
}

export function isInsideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  if (relative === '') return true;
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function canonicalize(absolute: string): Promise<string> {
  const missing: string[] = [];
  let current = absolute;
  for (;;) {
    try {
      const real = await realpath(current);
      return missing.length > 0 ? path.join(real, ...missing) : real;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error;
      const parent = path.dirname(current);
      if (parent === current) return absolute;
      missing.unshift(path.basename(current));
      current = parent;
    }
  }
}
