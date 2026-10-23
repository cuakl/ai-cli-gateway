import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { simpleGit } from 'simple-git';
import { afterEach, describe, expect, it } from 'vitest';
import { GitDiffSummarySchema } from '@aidev/protocol';
import { commit, getDiff, inspectWorkingTree, parseUnifiedDiff, revert } from '../src/workspace/git-service.js';

const exec = promisify(execFile);
const roots: string[] = [];

describe('git service', () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('parses a unified diff into hunks', () => {
    const files = parseUnifiedDiff(`diff --git a/src/App.tsx b/src/App.tsx
index 1111111..2222222 100644
--- a/src/App.tsx
+++ b/src/App.tsx
@@ -10,3 +10,3 @@
 const value = 1;
-const color = "blue";
+const color = "emerald";
 return value;
diff --git a/old.txt b/new.txt
similarity index 100%
rename from old.txt
rename to new.txt
`);
    expect(files).toHaveLength(2);
    expect(files[0]).toMatchObject({
      path: 'src/App.tsx',
      status: 'modified',
      additions: 1,
      deletions: 1,
    });
    expect(files[0]?.hunks?.[0]).toMatchObject({ oldStart: 10, oldLines: 3, newStart: 10, newLines: 3 });
    expect(files[0]?.hunks?.[0]?.content).toContain('+const color = "emerald";');
    expect(files[1]).toMatchObject({ path: 'new.txt', oldPath: 'old.txt', status: 'renamed' });
  });

  it('returns structured diffs, commits, and reverts a temporary repo', async () => {
    const dir = await createRepo();
    await writeFile(path.join(dir, 'app.txt'), 'hello\nworld\n');
    await writeFile(path.join(dir, 'extra.txt'), 'scratch\n');

    const diff = await getDiff(dir);
    expect(() => GitDiffSummarySchema.parse(diff)).not.toThrow();
    const modified = diff.files.find((file) => file.path === 'app.txt');
    const added = diff.files.find((file) => file.path === 'extra.txt');
    expect(modified).toMatchObject({ status: 'modified', additions: 1, deletions: 0 });
    expect(modified?.hunks?.[0]?.content).toContain('+world');
    expect(added).toMatchObject({ status: 'added', additions: 1 });
    expect(diff.insertions).toBeGreaterThanOrEqual(2);
    expect(diff.raw).toContain('app.txt');

    await revert(dir, ['app.txt']);
    const afterRevert = await getDiff(dir);
    expect(afterRevert.files.map((file) => file.path)).toEqual(['extra.txt']);

    const created = await commit(dir, { message: 'feat: keep the scratch file' });
    expect(created.commitHash).toMatch(/^[0-9a-f]{7,}$/);
    expect(created.branch.length).toBeGreaterThan(0);
    expect((await getDiff(dir)).files).toEqual([]);
    const log = await exec('git', ['log', '-1', '--format=%s'], { cwd: dir });
    expect(log.stdout.trim()).toBe('feat: keep the scratch file');
  });

  it('pushes the commit to origin', async () => {
    const dir = await createRepo();
    const origin = await mkdtemp(path.join(tmpdir(), 'ai-devtools-origin-'));
    roots.push(origin);
    await exec('git', ['init', '--bare', origin]);
    const git = simpleGit(dir);
    await git.remote(['add', 'origin', origin]);
    await writeFile(path.join(dir, 'app.txt'), 'hello\nshipped\n');

    const created = await commit(dir, { message: 'feat: ship', push: true });
    const remoteLog = await exec('git', ['--git-dir', origin, 'log', '-1', '--format=%s', created.branch]);
    expect(remoteLog.stdout.trim()).toBe('feat: ship');
    expect(created.commitHash.length).toBeGreaterThan(7);
  });

  it('warns about uncommitted files and unresolved conflicts', async () => {
    const clean = await createRepo();
    expect(await inspectWorkingTree(clean)).toMatchObject({ clean: true, conflicted: [], dirty: [] });

    await writeFile(path.join(clean, 'app.txt'), 'hello\nchanged\n');
    await writeFile(path.join(clean, 'notes.txt'), 'scratch\n');
    const dirty = await inspectWorkingTree(clean);
    expect(dirty.clean).toBe(false);
    expect(dirty.dirty).toEqual(expect.arrayContaining(['app.txt', 'notes.txt']));
    expect(dirty.warning).toMatch(/uncommitted changes \(2 files\)/);

    const conflicted = await createRepo();
    const git = simpleGit(conflicted);
    await git.checkoutLocalBranch('side');
    await writeFile(path.join(conflicted, 'app.txt'), 'side\n');
    await git.add('.');
    await git.commit('side');
    await git.checkout('main');
    await writeFile(path.join(conflicted, 'app.txt'), 'main\n');
    await git.add('.');
    await git.commit('main');
    await expect(git.merge(['side'])).rejects.toThrow();

    const report = await inspectWorkingTree(conflicted);
    expect(report.conflicted).toContain('app.txt');
    expect(report.warning).toMatch(/unresolved conflicts in app\.txt/);
  });

  it('limits the diff to a nested project directory and rejects paths outside it', async () => {
    const dir = await createRepo();
    const demo = path.join(dir, 'apps', 'demo');
    await mkdir(demo, { recursive: true });
    await writeFile(path.join(dir, 'root.txt'), 'root\n');
    await writeFile(path.join(demo, 'app.txt'), 'demo\n');
    const git = simpleGit(dir);
    await git.add('.');
    await git.commit('seed nested');
    await writeFile(path.join(dir, 'root.txt'), 'root changed\n');
    await writeFile(path.join(demo, 'app.txt'), 'demo changed\n');

    const diff = await getDiff(demo);
    expect(diff.files.map((file) => file.path)).toEqual(['app.txt']);
    expect(diff.files[0]?.hunks?.[0]?.content).toContain('+demo changed');

    await expect(revert(demo, ['../root.txt'])).rejects.toThrow(/escapes the project root|Invalid path/);
    expect(await readFile(path.join(dir, 'root.txt'), 'utf8')).toBe('root changed\n');
  });

  it('shows an untracked symlink without reading the target', async () => {
    const dir = await createRepo();
    const outside = await mkdtemp(path.join(tmpdir(), 'ai-devtools-secret-'));
    roots.push(outside);
    await writeFile(path.join(outside, 'secret.txt'), 'TOP-SECRET-CONTENTS\n');
    await symlink(path.join(outside, 'secret.txt'), path.join(dir, 'link.txt'));
    const diff = await getDiff(dir);
    expect(JSON.stringify(diff)).not.toContain('TOP-SECRET-CONTENTS');
    const link = diff.files.find((file) => file.path === 'link.txt');
    expect(link?.patch).toContain('symlink ->');
  });

  it('deletes only the listed untracked path', async () => {
    const dir = await createRepo();
    await writeFile(path.join(dir, 'keep.txt'), 'stay\n');
    await writeFile(path.join(dir, 'drop.txt'), 'gone\n');
    await writeFile(path.join(dir, 'app.txt'), 'hello\nchanged\n');
    await revert(dir, ['drop.txt']);
    expect(await readFile(path.join(dir, 'keep.txt'), 'utf8')).toBe('stay\n');
    await expect(readFile(path.join(dir, 'drop.txt'))).rejects.toThrow();
    expect(await readFile(path.join(dir, 'app.txt'), 'utf8')).toBe('hello\nchanged\n');
  });

  it('refuses to discard a symlink whose target leaves the project', async () => {
    const dir = await createRepo();
    const outside = await mkdtemp(path.join(tmpdir(), 'ai-devtools-outside-'));
    roots.push(outside);
    const secret = path.join(outside, 'secret.txt');
    await writeFile(secret, 'keep-me\n');
    await symlink(secret, path.join(dir, 'link.txt'));
    await expect(revert(dir, ['link.txt'])).rejects.toThrow(/escapes the project root/);
    expect(await readFile(secret, 'utf8')).toBe('keep-me\n');
  });
});

async function createRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'ai-devtools-git-'));
  roots.push(dir);
  const git = simpleGit(dir);
  await git.init(['-b', 'main']);
  await git.addConfig('user.name', 'DevTools Test');
  await git.addConfig('user.email', 'devtools@example.com');
  await writeFile(path.join(dir, 'app.txt'), 'hello\n');
  await git.add('.');
  await git.commit('init');
  return dir;
}
