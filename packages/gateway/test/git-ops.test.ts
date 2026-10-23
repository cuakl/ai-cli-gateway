import { execFile } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { WorkspaceServerMessage } from '@aidev/protocol';
import { simpleGit } from 'simple-git';
import {
  createBranch,
  createPullRequest,
  discardHunk,
  getDiff,
  gitLog,
  resetGhStatusCache,
  undoCommit,
} from '../src/workspace/git-service.js';
import { isRecord, postJson, startTestServer, type TestServer } from './helpers.js';
import { runtimeFor, ScriptedAdapter } from './scripted-adapter.js';

const exec = promisify(execFile);
const roots: string[] = [];
const servers: TestServer[] = [];
const originalPath = process.env.PATH;

describe('git branch, log, undo, hunk, and PR', () => {
  afterEach(async () => {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    resetGhStatusCache();
    await Promise.all(servers.splice(0).map((server) => server.close()));
    await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('creates a valid branch and rejects invalid or existing names', async () => {
    const dir = await createRepo();
    expect(await createBranch(dir, 'feature/topic')).toBe('feature/topic');
    expect((await exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir })).stdout.trim()).toBe(
      'feature/topic',
    );

    await expect(createBranch(dir, 'bad..name')).rejects.toMatchObject({
      name: 'GitOpError',
      code: 'invalid_branch',
    });
    await expect(createBranch(dir, '-x')).rejects.toMatchObject({
      name: 'GitOpError',
      code: 'invalid_branch',
    });
    await expect(createBranch(dir, 'feature/topic')).rejects.toMatchObject({
      name: 'GitOpError',
      code: 'branch_exists',
    });
  });

  it('marks pushed commits and soft-resets only unpushed HEAD', async () => {
    const { dir } = await createRepoWithOrigin();
    const pushed = await gitLog(dir, 10);
    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toMatchObject({ subject: 'init', pushed: true });
    await expect(undoCommit(dir)).rejects.toMatchObject({ name: 'GitOpError', code: 'already_pushed' });

    await writeFile(path.join(dir, 'app.txt'), 'hello\nshipped\n');
    await exec('git', ['add', 'app.txt'], { cwd: dir });
    await exec('git', ['commit', '-m', 'feat: ship'], { cwd: dir });

    const log = await gitLog(dir, 10);
    expect(log.map((entry) => ({ subject: entry.subject, pushed: entry.pushed }))).toEqual([
      { subject: 'feat: ship', pushed: false },
      { subject: 'init', pushed: true },
    ]);

    const undone = await undoCommit(dir);
    expect(undone).toBe(log[0]?.hash);
    expect((await exec('git', ['log', '-1', '--format=%s'], { cwd: dir })).stdout.trim()).toBe('init');
    expect((await exec('git', ['diff', '--cached', '--name-only'], { cwd: dir })).stdout.trim()).toBe('app.txt');
    expect(await readFile(path.join(dir, 'app.txt'), 'utf8')).toBe('hello\nshipped\n');
    await expect(undoCommit(dir)).rejects.toMatchObject({ name: 'GitOpError', code: 'already_pushed' });
  });

  it('discards only the requested hunk', async () => {
    const dir = await createRepo();
    const lines = Array.from({ length: 40 }, (_, index) => `line-${String(index + 1).padStart(2, '0')}`);
    await writeFile(path.join(dir, 'app.txt'), `${lines.join('\n')}\n`);
    await exec('git', ['add', 'app.txt'], { cwd: dir });
    await exec('git', ['commit', '-m', 'seed lines'], { cwd: dir });

    const edited = [...lines];
    edited[1] = 'line-02-CHANGED';
    edited[35] = 'line-36-CHANGED';
    await writeFile(path.join(dir, 'app.txt'), `${edited.join('\n')}\n`);

    const before = await getDiff(dir, ['app.txt']);
    expect(before.files[0]?.hunks).toHaveLength(2);

    await discardHunk(dir, 'app.txt', 1);
    const after = await readFile(path.join(dir, 'app.txt'), 'utf8');
    expect(after).toContain('line-02-CHANGED');
    expect(after).toContain('line-36');
    expect(after).not.toContain('line-36-CHANGED');
    const remaining = await getDiff(dir, ['app.txt']);
    expect(remaining.files[0]?.hunks).toHaveLength(1);
    expect(remaining.files[0]?.hunks?.[0]?.content).toContain('+line-02-CHANGED');
  });

  it('creates a pull request with argv passed verbatim and pushes the branch', async () => {
    const { dir, origin } = await createRepoWithOrigin();
    await writeFile(path.join(dir, 'app.txt'), 'hello\npr\n');
    await exec('git', ['add', 'app.txt'], { cwd: dir });
    await exec('git', ['commit', '-m', 'feat: pr'], { cwd: dir });

    const argsFile = path.join(dir, 'gh-args.txt');
    await installFakeGh(argsFile);
    const title = 'Fix "the $(x)" bug';
    const created = await createPullRequest(dir, {
      title,
      body: 'Details with spaces',
      base: 'main',
    });
    expect(created.url).toBe('https://github.com/o/r/pull/1');

    const invocations = parseArgvLog(await readFile(argsFile, 'utf8'));
    const pr = invocations.find((args) => args[0] === 'pr' && args[1] === 'create');
    expect(pr).toEqual(['pr', 'create', '--title', title, '--body', 'Details with spaces', '--base', 'main']);
    expect((await exec('git', ['--git-dir', origin, 'log', '-1', '--format=%s', 'main'])).stdout.trim()).toBe(
      'feat: pr',
    );
  });

  it('errors clearly when gh is missing', async () => {
    const dir = await createRepo();
    await isolateGitOnPath();
    resetGhStatusCache();
    await expect(createPullRequest(dir, { title: 'x', body: '', base: 'main' })).rejects.toMatchObject({
      name: 'GitOpError',
      code: 'gh_unavailable',
    });
  });

  it('creates a branch over the workspace socket', async () => {
    const dir = await createRepo();
    const server = await startTestServer({
      root: dir,
      registerDefaultRoot: false,
      authenticateFetch: false,
      runtime: runtimeFor({ cursor: new ScriptedAdapter('cursor', async () => ({ exitCode: 0, summary: '' })) }),
    });
    servers.push(server);
    const project = await register(server, dir);
    const socket = await openSocket(projectWs(server, project.id, project.token));
    const messages = collect(socket);
    try {
      socket.send(JSON.stringify({ type: 'git.branch.create', requestId: 'br1', name: 'ws-topic' }));
      await messages.waitFor((items) => items.some((item) => item.requestId === 'br1'));
      expect(messages.items.find((item) => item.requestId === 'br1')).toMatchObject({
        type: 'git.branch.create.result',
        name: 'ws-topic',
      });
      expect((await exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir })).stdout.trim()).toBe('ws-topic');
    } finally {
      await closeSocket(socket);
    }
  });
});

async function createRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'ai-devtools-gitops-'));
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

async function createRepoWithOrigin(): Promise<{ dir: string; origin: string }> {
  const dir = await createRepo();
  const origin = await mkdtemp(path.join(tmpdir(), 'ai-devtools-origin-'));
  roots.push(origin);
  await exec('git', ['init', '--bare', origin]);
  await exec('git', ['remote', 'add', 'origin', origin], { cwd: dir });
  await exec('git', ['push', '-u', 'origin', 'main'], { cwd: dir });
  return { dir, origin };
}

async function installFakeGh(argsFile: string): Promise<void> {
  const bin = await mkdtemp(path.join(tmpdir(), 'ai-devtools-gh-bin-'));
  roots.push(bin);
  const gh = path.join(bin, 'gh');
  await writeFile(
    gh,
    `#!/bin/sh
{
  echo '---'
  for arg in "$@"; do
    printf '%s\\n' "$arg"
  done
} >> "$GH_ARGS_FILE"
if [ "$1" = "auth" ]; then
  exit 0
fi
echo "https://github.com/o/r/pull/1"
`,
    { mode: 0o755 },
  );
  await chmod(gh, 0o755);
  process.env.GH_ARGS_FILE = argsFile;
  process.env.PATH = `${bin}${path.delimiter}${process.env.PATH ?? ''}`;
  resetGhStatusCache();
}

async function isolateGitOnPath(): Promise<void> {
  const bin = await mkdtemp(path.join(tmpdir(), 'ai-devtools-git-only-'));
  roots.push(bin);
  const git = (await exec('which', ['git'])).stdout.trim();
  await symlink(git, path.join(bin, 'git'));
  process.env.PATH = bin;
}

function parseArgvLog(raw: string): string[][] {
  return raw
    .split(/^---$/m)
    .map((block) => block.split('\n').filter((line) => line.length > 0))
    .filter((args) => args.length > 0);
}

async function register(server: TestServer, root: string): Promise<{ id: string; token: string }> {
  const response = await postJson(
    `${server.url}/api/v1/projects/register`,
    { root, origin: 'http://localhost:5173' },
    { headers: { authorization: `Bearer ${server.token}` } },
  );
  if (
    !isRecord(response.body) ||
    typeof response.body.projectId !== 'string' ||
    typeof response.body.browserToken !== 'string'
  ) {
    throw new Error(`register failed: ${JSON.stringify(response.body)}`);
  }
  return { id: response.body.projectId, token: response.body.browserToken };
}

function projectWs(server: TestServer, projectId: string, token: string): string {
  const url = new URL(server.url);
  url.protocol = 'ws:';
  url.pathname = `/api/v1/projects/${projectId}/ws`;
  url.searchParams.set('token', token);
  return url.toString();
}

function openSocket(url: string): Promise<WebSocket> {
  const socket = new WebSocket(url);
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve(socket));
    socket.once('error', (error) => reject(error));
  });
}

function closeSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => {
    socket.once('close', () => resolve());
    socket.close();
  });
}

function collect(socket: WebSocket): {
  items: WorkspaceServerMessage[];
  waitFor: (ready: (items: WorkspaceServerMessage[]) => boolean) => Promise<void>;
} {
  const items: WorkspaceServerMessage[] = [];
  socket.on('message', (data) => {
    items.push(JSON.parse(String(data)) as WorkspaceServerMessage);
  });
  return {
    items,
    async waitFor(ready) {
      const started = Date.now();
      while (!ready(items)) {
        if (Date.now() - started > 5_000) throw new Error(`messages: ${JSON.stringify(items)}`);
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
    },
  };
}
