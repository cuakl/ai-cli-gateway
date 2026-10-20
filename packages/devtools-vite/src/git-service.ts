import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import {
  GitDiffSummarySchema,
  type GitCommitRequest,
  type GitDiffFile,
  type GitDiffHunk,
  type GitDiffSummary,
  type GitFileStatus,
} from '@gateway/shared-types';
import { simpleGit, type FileStatusResult, type SimpleGit } from 'simple-git';

const TEXT_LIMIT = 1_500_000;

export interface GitCommitResult {
  commitHash: string;
  branch: string;
}

export interface WorkingTreeReport {
  clean: boolean;
  conflicted: string[];
  dirty: string[];
  warning?: string;
}

interface RepoContext {
  git: SimpleGit;
  top: string;
  /** Directory the Vite project occupies, relative to the git root. `.` at the root. */
  scope: string;
  projectRoot: string;
}

/**
 * Structured diff of staged, unstaged, and untracked changes inside `rootDir`.
 * When `rootDir` is a package inside a larger repo, the summary stays inside that package.
 */
export async function getDiff(rootDir: string): Promise<GitDiffSummary> {
  const repo = await openRepo(rootDir);
  const status = await repo.git.status(['--', repo.scope]);
  let raw = '';
  try {
    raw = await repo.git.diff(['HEAD', '--', repo.scope]);
  } catch {
    raw = '';
  }
  const parsed = new Map(parseUnifiedDiff(raw).map((file) => [file.path, file]));
  const files: GitDiffFile[] = [];
  const seen = new Set<string>();

  for (const entry of status.files) {
    seen.add(entry.path);
    const fromDiff = parsed.get(entry.path);
    const statusName = mapStatus(entry);
    if (fromDiff) {
      files.push(presentFile(repo.scope, { ...fromDiff, status: statusName, oldPath: entry.from ?? fromDiff.oldPath }));
      continue;
    }
    if (statusName === 'added') {
      files.push(presentFile(repo.scope, await describeUntracked(repo.top, entry.path)));
      continue;
    }
    files.push(
      presentFile(repo.scope, {
        path: entry.path,
        ...(entry.from ? { oldPath: entry.from } : {}),
        status: statusName,
        additions: 0,
        deletions: 0,
      }),
    );
  }

  for (const file of parsed.values()) {
    if (!seen.has(file.path)) files.push(presentFile(repo.scope, file));
  }
  for (const file of status.not_added) {
    if (seen.has(file)) continue;
    seen.add(file);
    files.push(presentFile(repo.scope, await describeUntracked(repo.top, file)));
  }

  const extras = files
    .filter((file) => file.patch && !raw.includes(`b/${toRepoPath(repo.scope, file.path)}`))
    .map((file) => file.patch)
    .filter((patch): patch is string => Boolean(patch));
  const summary: GitDiffSummary = {
    branch: branchName(status.current),
    files,
    insertions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
    raw: [raw.trim(), ...extras].filter(Boolean).join('\n'),
  };
  return GitDiffSummarySchema.parse(summary);
}

/**
 * Look at `git status` before an agent edit. A clean tree has no warning.
 * Conflicts and other uncommitted changes (including untracked files) do.
 * A directory that is not a git repo is treated as clean so the prompt can proceed.
 */
export async function inspectWorkingTree(rootDir: string): Promise<WorkingTreeReport> {
  try {
    const repo = await openRepo(rootDir);
    const status = await repo.git.status(['--', repo.scope]);
    const conflicted = unique(status.conflicted);
    const dirty = unique([...status.files.map((entry) => entry.path), ...status.not_added]);
    const warning = workingTreeWarning(conflicted, dirty);
    return {
      clean: conflicted.length === 0 && dirty.length === 0,
      conflicted,
      dirty,
      ...(warning ? { warning } : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || /not a git repository/i.test(message)) {
      return { clean: true, conflicted: [], dirty: [] };
    }
    throw error;
  }
}

export function workingTreeWarning(conflicted: string[], dirty: string[]): string | undefined {
  if (conflicted.length > 0) {
    const listed = conflicted.slice(0, 5).join(', ');
    const extra = conflicted.length > 5 ? ` and ${conflicted.length - 5} more` : '';
    return `Warning: Git reports unresolved conflicts in ${listed}${extra}. Applying AI edits can overwrite those files.`;
  }
  if (dirty.length > 0) {
    const noun = dirty.length === 1 ? 'file' : 'files';
    return `Warning: The working tree already has uncommitted changes (${dirty.length} ${noun}). Review them before the agent edits more files.`;
  }
  return undefined;
}

/** Stage the requested files (or the project directory) and commit. Push when asked. */
export async function commit(rootDir: string, request: GitCommitRequest): Promise<GitCommitResult> {
  const repo = await openRepo(rootDir);
  const paths = request.files?.length
    ? request.files.map((file) => assertInProject(repo, file))
    : [repo.scope];
  await repo.git.add(paths);
  const created = await repo.git.commit(request.message);
  const commitHash = created.commit.trim();
  const branch = created.branch.trim() || (await currentBranch(repo.git));
  if (!commitHash) throw new Error('Git did not return a commit hash');
  if (request.push) {
    try {
      await repo.git.push('origin', branch);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'push failed';
      throw new Error(`Committed ${commitHash} on ${branch}, but push failed: ${message}`);
    }
  }
  return { commitHash, branch };
}

/**
 * Discard uncommitted changes. Tracked files are restored from HEAD.
 * Staged new files are removed, and untracked files are cleaned.
 */
export async function revert(rootDir: string, files?: string[]): Promise<void> {
  const repo = await openRepo(rootDir);
  const requested = files?.map((file) => assertInProject(repo, file));
  const status = await repo.git.status(['--', ...(requested?.length ? requested : [repo.scope])]);
  const entries = requested?.length
    ? status.files.filter((entry) => requested.includes(entry.path) || (entry.from ? requested.includes(entry.from) : false))
    : status.files;

  const tracked: string[] = [];
  const added: string[] = [];
  const untracked: string[] = [];
  for (const entry of entries) {
    if (isUntracked(entry)) {
      untracked.push(entry.path);
      continue;
    }
    if (entry.index === 'A') {
      added.push(entry.path);
      continue;
    }
    tracked.push(entry.path);
    if (entry.from) tracked.push(entry.from);
  }

  if (tracked.length > 0) await restoreTracked(repo.git, unique(tracked));
  if (added.length > 0) await repo.git.raw(['rm', '-f', '--', ...unique(added)]);
  if (untracked.length > 0) await repo.git.raw(['clean', '-fd', '--', ...unique(untracked)]);
}

/** Split a unified diff into per-file hunks. Paths stay as git printed them. */
export function parseUnifiedDiff(raw: string): GitDiffFile[] {
  const files: Array<GitDiffFile & { patchLines: string[] }> = [];
  let current: (GitDiffFile & { patchLines: string[] }) | null = null;
  let hunk: GitDiffHunk | null = null;
  let hunkLines: string[] = [];

  const flushHunk = (): void => {
    if (!current || !hunk) return;
    hunk.content = hunkLines.join('\n');
    current.hunks = [...(current.hunks ?? []), hunk];
    hunk = null;
    hunkLines = [];
  };

  const flushFile = (): void => {
    flushHunk();
    if (!current) return;
    current.patch = current.patchLines.join('\n');
    files.push(current);
    current = null;
  };

  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith('diff --git ')) {
      flushFile();
      const paths = parseDiffGit(line);
      current = {
        path: paths?.newPath || 'unknown',
        ...(paths && paths.oldPath !== paths.newPath ? { oldPath: paths.oldPath } : {}),
        status: 'modified',
        additions: 0,
        deletions: 0,
        hunks: [],
        patchLines: [line],
      };
      continue;
    }
    if (!current) continue;
    current.patchLines.push(line);
    if (line.startsWith('new file mode')) current.status = 'added';
    else if (line.startsWith('deleted file mode')) current.status = 'deleted';
    else if (line.startsWith('rename from ')) {
      current.status = 'renamed';
      current.oldPath = line.slice('rename from '.length);
    } else if (line.startsWith('rename to ')) current.path = line.slice('rename to '.length);
    else if (line.startsWith('copy from ')) {
      current.status = 'copied';
      current.oldPath = line.slice('copy from '.length);
    } else if (line.startsWith('copy to ')) current.path = line.slice('copy to '.length);
    else if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) current.binary = true;
    else if (line.startsWith('--- /dev/null')) current.status = current.status === 'modified' ? 'added' : current.status;
    else if (line.startsWith('+++ /dev/null')) current.status = 'deleted';
    else if (line.startsWith('@@')) {
      flushHunk();
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      hunk = {
        oldStart: Number(match?.[1] ?? 0),
        oldLines: Number(match?.[2] ?? 1),
        newStart: Number(match?.[3] ?? 0),
        newLines: Number(match?.[4] ?? 1),
        content: '',
      };
      hunkLines = [];
    } else if (hunk && isDiffBodyLine(line)) {
      if (line.startsWith('+')) current.additions += 1;
      else if (line.startsWith('-')) current.deletions += 1;
      hunkLines.push(line);
    }
  }
  flushFile();
  return files.map(({ patchLines: _patchLines, ...file }) => file);
}

async function openRepo(rootDir: string): Promise<RepoContext> {
  const projectRoot = await realpath(path.resolve(rootDir));
  const probe = simpleGit(projectRoot);
  let top = '';
  try {
    top = await realpath(path.resolve((await probe.revparse(['--show-toplevel'])).trim()));
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/not a git repository/i.test(message)) {
      throw new Error('This project is not a git repository');
    }
    throw error;
  }
  const relative = path.relative(top, projectRoot);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Project root is outside the git repository');
  }
  const scope = relative === '' ? '.' : relative.split(path.sep).join('/');
  return { git: simpleGit(top), top, scope, projectRoot };
}

function mapStatus(entry: FileStatusResult): GitFileStatus {
  if (entry.index === 'R' || entry.working_dir === 'R') return 'renamed';
  if (entry.index === 'C' || entry.working_dir === 'C') return 'copied';
  if (entry.index === '?' || entry.working_dir === '?' || entry.index === 'A') return 'added';
  if (entry.index === 'D' || entry.working_dir === 'D') return 'deleted';
  return 'modified';
}

function isUntracked(entry: FileStatusResult): boolean {
  return entry.index === '?' || entry.working_dir === '?';
}

async function describeUntracked(top: string, repoPath: string): Promise<GitDiffFile> {
  const absolute = path.join(top, repoPath);
  let text = '';
  try {
    const buffer = await readFile(absolute);
    if (buffer.includes(0) || buffer.length > TEXT_LIMIT) {
      return { path: repoPath, status: 'added', additions: 0, deletions: 0, binary: true };
    }
    text = buffer.toString('utf8');
  } catch {
    return { path: repoPath, status: 'added', additions: 0, deletions: 0 };
  }
  const lines = text.split(/\r?\n/);
  if (text.endsWith('\n')) lines.pop();
  const body = lines.map((line) => `+${line}`).join('\n');
  const hunk: GitDiffHunk = {
    oldStart: 0,
    oldLines: 0,
    newStart: 1,
    newLines: lines.length,
    content: body,
  };
  const patch = [
    `diff --git a/${repoPath} b/${repoPath}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${repoPath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    body,
  ]
    .filter((line, index, all) => line !== '' || index < all.length - 1)
    .join('\n');
  return {
    path: repoPath,
    status: 'added',
    additions: lines.length,
    deletions: 0,
    patch,
    ...(lines.length > 0 ? { hunks: [hunk] } : {}),
  };
}

function presentFile(scope: string, file: GitDiffFile): GitDiffFile {
  const { oldPath, ...rest } = file;
  return {
    ...rest,
    path: toProjectPath(scope, file.path),
    ...(oldPath ? { oldPath: toProjectPath(scope, oldPath) } : {}),
  };
}

function assertInProject(repo: RepoContext, file: string): string {
  const normalized = file.split('\\').join('/');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error(`Invalid path: ${file}`);
  }
  const repoPath = toRepoPath(repo.scope, normalized);
  const absolute = path.resolve(repo.top, repoPath);
  const relative = path.relative(repo.projectRoot, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path escapes the project root: ${file}`);
  }
  return repoPath;
}

function toProjectPath(scope: string, repoPath: string): string {
  if (scope === '.' || scope === '') return repoPath;
  const prefix = `${scope}/`;
  return repoPath.startsWith(prefix) ? repoPath.slice(prefix.length) : repoPath;
}

function toRepoPath(scope: string, projectPath: string): string {
  if (scope === '.' || scope === '') return projectPath;
  return `${scope}/${projectPath}`.replace(/\/{2,}/g, '/');
}

async function restoreTracked(git: SimpleGit, paths: string[]): Promise<void> {
  try {
    await git.checkout(['HEAD', '--', ...paths]);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/did not match|needed a single revision|unknown revision|ambiguous argument 'HEAD'/i.test(message)) return;
    throw error;
  }
}

async function currentBranch(git: SimpleGit): Promise<string> {
  return (await git.revparse(['--abbrev-ref', 'HEAD'])).trim() || 'HEAD';
}

function branchName(current: string | null): string | undefined {
  const name = current?.trim();
  return name ? name : undefined;
}

function parseDiffGit(line: string): { oldPath: string; newPath: string } | null {
  const rest = line.slice('diff --git '.length);
  const oldPath = readGitPath(rest);
  if (!oldPath) return null;
  const next = rest.slice(oldPath.consumed).trimStart();
  const newPath = readGitPath(next);
  if (!newPath) return null;
  return {
    oldPath: stripDiffPrefix(oldPath.path, 'a/'),
    newPath: stripDiffPrefix(newPath.path, 'b/'),
  };
}

function readGitPath(input: string): { path: string; consumed: number } | null {
  if (input.startsWith('"')) {
    let value = '';
    for (let index = 1; index < input.length; index += 1) {
      const char = input[index];
      if (char === '\\' && index + 1 < input.length) {
        value += input[index + 1];
        index += 1;
        continue;
      }
      if (char === '"') return { path: value, consumed: index + 1 };
      value += char ?? '';
    }
    return null;
  }
  const match = /^\S+/.exec(input);
  if (!match) return null;
  return { path: match[0], consumed: match[0].length };
}

function stripDiffPrefix(file: string, prefix: string): string {
  return file.startsWith(prefix) ? file.slice(prefix.length) : file;
}

function isDiffBodyLine(line: string): boolean {
  return line.startsWith('+') || line.startsWith('-') || line.startsWith(' ') || line.startsWith('\\');
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
