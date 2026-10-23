import { execFile } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, readlink, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { PathEscapeError, confineToRoot } from '@aidev/adapters';
import {
  GitDiffSummarySchema,
  GitStatusSchema,
  type GitCommitRequest,
  type GitDiffFile,
  type GitDiffHunk,
  type GitDiffSummary,
  type GitFileStatus,
  type GitLogEntry,
  type GitStatus,
  type RunCheckpoint,
} from '@aidev/protocol';
import { simpleGit, type FileStatusResult, type SimpleGit } from 'simple-git';

const exec = promisify(execFile);
const BLOB_LIMIT = 20 * 1024 * 1024;

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
export async function getDiff(rootDir: string, paths?: string[]): Promise<GitDiffSummary> {
  const repo = await openRepo(rootDir);
  let allowed: Set<string> | undefined;
  if (paths?.length) {
    allowed = new Set();
    for (const file of paths) {
      const repoPath = await assertInProject(repo, file);
      allowed.add(toProjectPath(repo.scope, repoPath));
    }
  }
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
      files.push(presentFile(repo.scope, await describeUntracked(repo, entry.path)));
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
    files.push(presentFile(repo.scope, await describeUntracked(repo, file)));
  }

  let visible = files;
  if (allowed) {
    const allow = allowed;
    visible = files.filter(
      (file) => allow.has(file.path) || (file.oldPath ? allow.has(file.oldPath) : false),
    );
  }

  const extras = visible
    .filter((file) => file.patch && !raw.includes(`b/${toRepoPath(repo.scope, file.path)}`))
    .map((file) => file.patch)
    .filter((patch): patch is string => Boolean(patch));
  const summary: GitDiffSummary = {
    branch: branchName(status.current),
    files: visible,
    insertions: visible.reduce((total, file) => total + file.additions, 0),
    deletions: visible.reduce((total, file) => total + file.deletions, 0),
    raw: allowed
      ? visible
          .map((file) => file.patch)
          .filter((patch): patch is string => Boolean(patch))
          .join('\n')
      : [raw.trim(), ...extras].filter(Boolean).join('\n'),
  };
  return GitDiffSummarySchema.parse(summary);
}

/** Branch, cleanliness, conflicts, and dirty paths inside the project. */
export async function gitStatus(rootDir: string): Promise<GitStatus> {
  const repo = await openRepo(rootDir);
  const status = await repo.git.status(['--', repo.scope]);
  const conflicted = unique(status.conflicted).map((file) => toProjectPath(repo.scope, file));
  const dirty = unique([...status.files.map((entry) => entry.path), ...status.not_added]).map((file) =>
    toProjectPath(repo.scope, file),
  );
  return GitStatusSchema.parse({
    branch: branchName(status.current) ?? 'HEAD',
    clean: conflicted.length === 0 && dirty.length === 0,
    conflicted,
    dirty,
  });
}

/** Recent commits that touch the project scope. `at` is epoch milliseconds. */
export async function gitLog(rootDir: string, limit: number): Promise<GitLogEntry[]> {
  const repo = await openRepo(rootDir);
  const capped = Math.min(Math.max(1, Math.floor(limit)), 200);
  const raw = await repo.git.raw(['log', `-n${capped}`, '--format=%H%x09%s%x09%ct', '--', repo.scope]);
  const commits: GitLogEntry[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const [hash, subject, at] = line.split('\t');
    if (!hash) continue;
    const seconds = Number(at ?? 0);
    commits.push({
      hash,
      subject: subject ?? '',
      at: Number.isFinite(seconds) ? Math.max(0, Math.trunc(seconds * 1000)) : 0,
    });
  }
  return commits;
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

export function checkpointRef(runId: string): string {
  return `refs/aidev/checkpoints/${runId}`;
}

/**
 * Snapshot the project working tree (tracked + untracked, not ignored) without
 * touching the real index or files. Uses a private `GIT_INDEX_FILE`, `git add -A`
 * of the project scope, then `write-tree` + `commit-tree` parented at HEAD.
 *
 * `git stash create` is not enough: it ignores untracked files, so undo could
 * not put a dirty untracked file back. Repos with no commits return `null`
 * and the run proceeds without a checkpoint.
 */
export async function createCheckpoint(rootDir: string, runId: string): Promise<RunCheckpoint | null> {
  let repo: RepoContext;
  try {
    repo = await openRepo(rootDir);
  } catch (error) {
    if (isMissingRepo(error)) return null;
    throw error;
  }
  const head = await readHead(repo);
  if (!head) return null;
  const dirtyBefore = await dirtyProjectPaths(repo);
  const indexDir = await mkdtemp(path.join(tmpdir(), 'aidev-ckpt-'));
  const indexFile = path.join(indexDir, 'index');
  const env = checkpointEnv(indexFile);
  try {
    await git(repo.top, ['read-tree', head], env);
    await git(repo.top, ['add', '-A', '--', repo.scope], env);
    const tree = await git(repo.top, ['write-tree'], env);
    if (!tree) throw new Error('git write-tree produced no tree');
    const commit = await git(repo.top, ['commit-tree', tree, '-p', head, '-m', `aidev checkpoint ${runId}`], env);
    if (!commit) throw new Error('git commit-tree produced no commit');
    const ref = checkpointRef(runId);
    await git(repo.top, ['update-ref', ref, commit]);
    return { ref, baseHead: head, dirtyBefore };
  } finally {
    await rm(indexDir, { recursive: true, force: true });
  }
}

/** Project-relative paths whose working-tree bytes differ from the snapshot, plus `fileEditPaths`. */
export async function filesChangedSinceCheckpoint(
  rootDir: string,
  checkpoint: RunCheckpoint,
  fileEditPaths: string[] = [],
): Promise<string[]> {
  const repo = await openRepo(rootDir);
  const dirtyNow = await dirtyProjectPaths(repo);
  const inSnapshot = await snapshotProjectPaths(repo, checkpoint.ref);
  const extras = await Promise.all(fileEditPaths.map((file) => normalizeProjectPath(repo, file)));
  const candidates = unique([
    ...dirtyNow,
    ...checkpoint.dirtyBefore,
    ...inSnapshot,
    ...extras.filter((file): file is string => Boolean(file)),
  ]);
  const touched: string[] = [];
  for (const projectPath of candidates) {
    const repoPath = toRepoPath(repo.scope, projectPath);
    if (!inScope(repo.scope, repoPath)) continue;
    const before = await snapshotBlob(repo, checkpoint.ref, repoPath);
    const after = await workingBlob(repo, repoPath);
    if (!blobsEqual(before, after)) touched.push(projectPath);
  }
  for (const extra of extras) {
    if (extra && !touched.includes(extra) && inScope(repo.scope, toRepoPath(repo.scope, extra))) {
      touched.push(extra);
    }
  }
  return unique(touched).sort();
}

/**
 * Rewrite only `files` from the checkpoint snapshot. Paths missing from the
 * snapshot are deleted. The real git index is left alone so a user's untracked
 * file stays untracked after undo.
 */
export async function restoreCheckpointFiles(
  rootDir: string,
  checkpoint: RunCheckpoint,
  files: string[],
): Promise<string[]> {
  if (files.length === 0) return [];
  const repo = await openRepo(rootDir);
  const restored: string[] = [];
  for (const file of files) {
    const projectPath = await normalizeProjectPath(repo, file);
    if (!projectPath) continue;
    const repoPath = await assertInProject(repo, projectPath);
    const blob = await snapshotBlob(repo, checkpoint.ref, repoPath);
    const absolute = await confineToRoot(repo.projectRoot, projectPath, repo.projectRoot);
    if (blob === null) {
      await removePath(absolute);
    } else {
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, blob);
    }
    restored.push(projectPath);
  }
  return restored;
}

export async function deleteCheckpointRef(rootDir: string, runId: string): Promise<void> {
  let repo: RepoContext;
  try {
    repo = await openRepo(rootDir);
  } catch (error) {
    if (isMissingRepo(error)) return;
    throw error;
  }
  try {
    await git(repo.top, ['update-ref', '-d', checkpointRef(runId)]);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/unable to delete|not exist|ambiguous argument/i.test(message)) return;
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
    ? await Promise.all(request.files.map((file) => assertInProject(repo, file)))
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
 * Discard uncommitted changes for the listed paths only.
 * Untracked files are deleted only when they were named explicitly.
 * An omitted or empty list does not touch the tree.
 */
export async function revert(rootDir: string, files?: string[]): Promise<string[]> {
  if (!files?.length) return [];
  const repo = await openRepo(rootDir);
  const requested = await Promise.all(files.map((file) => assertInProject(repo, file)));
  const requestedSet = new Set(requested);
  const status = await repo.git.status(['--', ...requested]);
  const entries = status.files.filter(
    (entry) => requestedSet.has(entry.path) || (entry.from ? requestedSet.has(entry.from) : false),
  );

  const tracked: string[] = [];
  const added: string[] = [];
  const untracked: string[] = [];
  for (const entry of entries) {
    if (isUntracked(entry)) {
      if (requestedSet.has(entry.path)) untracked.push(entry.path);
      continue;
    }
    if (entry.index === 'A') {
      if (requestedSet.has(entry.path)) added.push(entry.path);
      continue;
    }
    if (requestedSet.has(entry.path)) tracked.push(entry.path);
    if (entry.from && requestedSet.has(entry.from)) tracked.push(entry.from);
  }

  if (tracked.length > 0) await restoreTracked(repo.git, unique(tracked));
  if (added.length > 0) await repo.git.raw(['rm', '-f', '--', ...unique(added)]);
  if (untracked.length > 0) await cleanUntracked(repo, unique(untracked));
  return requested.map((repoPath) => toProjectPath(repo.scope, repoPath));
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

async function describeUntracked(repo: RepoContext, repoPath: string): Promise<GitDiffFile> {
  const absolute = path.resolve(repo.top, repoPath);
  if (!lexicalInside(repo.projectRoot, absolute)) {
    return { path: repoPath, status: 'added', additions: 0, deletions: 0 };
  }
  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(absolute);
  } catch {
    return { path: repoPath, status: 'added', additions: 0, deletions: 0 };
  }
  if (info.isSymbolicLink()) return describeSymlink(repoPath, absolute);
  if (!info.isFile()) return { path: repoPath, status: 'added', additions: 0, deletions: 0 };
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

/**
 * Accept a project-relative path only when its realpath stays inside the project.
 * The returned git path is the path the user named (a symlink is not rewritten to its target).
 */
async function assertInProject(repo: RepoContext, file: string): Promise<string> {
  const normalized = file.split('\\').join('/').trim();
  if (!normalized || normalized.includes('\0')) {
    throw new Error(`Invalid path: ${file}`);
  }
  try {
    await confineToRoot(repo.projectRoot, normalized, repo.projectRoot);
  } catch (error) {
    if (error instanceof PathEscapeError) throw new Error(error.message);
    throw error;
  }
  const absolute = path.resolve(repo.projectRoot, normalized);
  const relativeToTop = path.relative(repo.top, absolute);
  if (relativeToTop.startsWith('..') || path.isAbsolute(relativeToTop)) {
    throw new Error(`Path escapes the project root: ${file}`);
  }
  return relativeToTop.split(path.sep).join('/');
}

async function describeSymlink(repoPath: string, absolute: string): Promise<GitDiffFile> {
  let target = 'unknown';
  try {
    target = await readlink(absolute);
  } catch {
    target = 'unknown';
  }
  const line = `symlink -> ${target}`;
  return {
    path: repoPath,
    status: 'added',
    additions: 1,
    deletions: 0,
    patch: [
      `diff --git a/${repoPath} b/${repoPath}`,
      'new file mode 120000',
      '--- /dev/null',
      `+++ b/${repoPath}`,
      '@@ -0,0 +1 @@',
      `+${line}`,
    ].join('\n'),
  };
}

async function cleanUntracked(repo: RepoContext, repoPaths: string[]): Promise<void> {
  const files: string[] = [];
  const dirs: string[] = [];
  for (const repoPath of repoPaths) {
    try {
      const info = await lstat(path.join(repo.top, repoPath));
      if (info.isDirectory()) dirs.push(repoPath);
      else files.push(repoPath);
    } catch {
      files.push(repoPath);
    }
  }
  if (files.length > 0) await repo.git.raw(['clean', '-f', '--', ...files]);
  for (const dir of dirs) await repo.git.raw(['clean', '-fd', '--', dir]);
}

function lexicalInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  if (relative === '') return true;
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
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

async function dirtyProjectPaths(repo: RepoContext): Promise<string[]> {
  const status = await repo.git.status(['--', repo.scope]);
  return unique([...status.files.map((entry) => entry.path), ...status.not_added])
    .filter((repoPath) => inScope(repo.scope, repoPath))
    .map((repoPath) => toProjectPath(repo.scope, repoPath));
}

async function snapshotProjectPaths(repo: RepoContext, ref: string): Promise<string[]> {
  const raw = await git(repo.top, ['ls-tree', '-r', '--name-only', ref]);
  if (!raw) return [];
  return raw
    .split('\n')
    .filter((repoPath) => repoPath && inScope(repo.scope, repoPath))
    .map((repoPath) => toProjectPath(repo.scope, repoPath));
}

async function snapshotBlob(repo: RepoContext, ref: string, repoPath: string): Promise<Buffer | null> {
  try {
    await git(repo.top, ['cat-file', '-e', `${ref}:${repoPath}`]);
  } catch {
    return null;
  }
  return gitBuffer(repo.top, ['show', `${ref}:${repoPath}`]);
}

async function workingBlob(repo: RepoContext, repoPath: string): Promise<Buffer | null> {
  const absolute = path.resolve(repo.top, repoPath);
  if (!lexicalInside(repo.projectRoot, absolute)) return null;
  try {
    const info = await lstat(absolute);
    if (info.isSymbolicLink() || info.isDirectory()) return null;
    if (!info.isFile()) return null;
    return await readFile(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function blobsEqual(left: Buffer | null, right: Buffer | null): boolean {
  if (left === null && right === null) return true;
  if (left === null || right === null) return false;
  return left.equals(right);
}

async function normalizeProjectPath(repo: RepoContext, file: string): Promise<string | undefined> {
  const trimmed = file.split('\\').join('/').trim();
  if (!trimmed) return undefined;
  try {
    const relative = path.isAbsolute(trimmed)
      ? path.relative(repo.projectRoot, trimmed)
      : trimmed;
    if (relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
    await assertInProject(repo, relative);
    return relative.split(path.sep).join('/');
  } catch {
    return undefined;
  }
}

function inScope(scope: string, repoPath: string): boolean {
  if (scope === '.' || scope === '') return true;
  return repoPath === scope || repoPath.startsWith(`${scope}/`);
}

async function readHead(repo: RepoContext): Promise<string | null> {
  try {
    const head = (await repo.git.revparse(['HEAD'])).trim();
    if (!head || head === 'HEAD') return null;
    return head;
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/unknown revision|bad revision|needed a single revision|ambiguous argument 'HEAD'/i.test(message)) {
      return null;
    }
    throw error;
  }
}

function isMissingRepo(error: unknown): boolean {
  const message = error instanceof Error ? error.message : '';
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || /not a git repository/i.test(message);
}

function checkpointEnv(indexFile: string): NodeJS.ProcessEnv {
  return {
    GIT_INDEX_FILE: indexFile,
    GIT_AUTHOR_NAME: 'aidev',
    GIT_AUTHOR_EMAIL: 'aidev@localhost',
    GIT_COMMITTER_NAME: 'aidev',
    GIT_COMMITTER_EMAIL: 'aidev@localhost',
  };
}

async function git(top: string, args: string[], extraEnv?: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await exec('git', args, {
    cwd: top,
    maxBuffer: BLOB_LIMIT,
    env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
  });
  return (typeof stdout === 'string' ? stdout : Buffer.from(stdout).toString('utf8')).trim();
}

function gitBuffer(top: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: top, encoding: 'buffer', maxBuffer: BLOB_LIMIT }, (error, stdout) => {
      if (error) reject(error);
      else resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout));
    });
  });
}

async function removePath(absolute: string): Promise<void> {
  try {
    const info = await lstat(absolute);
    if (info.isDirectory()) await rm(absolute, { recursive: true, force: true });
    else await unlink(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
}
