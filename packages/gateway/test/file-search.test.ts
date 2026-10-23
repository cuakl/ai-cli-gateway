import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkspaceServerMessage } from '@aidev/protocol';
import { WebSocket } from 'ws';
import { rankFiles, resetFileSearchCache, searchProjectFiles } from '../src/workspace/file-search.js';
import { isRecord, postJson, startTestServer, type TestServer } from './helpers.js';
import { runtimeFor, ScriptedAdapter } from './scripted-adapter.js';

const exec = promisify(execFile);
const dirs: string[] = [];
const servers: TestServer[] = [];

describe('file search', () => {
  afterEach(async () => {
    resetFileSearchCache();
    await Promise.all(servers.splice(0).map((server) => server.close()));
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('ranks basename subsequence matches ahead of path-only matches', () => {
    const files = ['src/hero/util.ts', 'src/components/Hero.tsx', 'README.md', 'src/lib/button.ts'];
    expect(rankFiles(files, 'hero', 20)).toEqual(['src/components/Hero.tsx', 'src/hero/util.ts']);
    expect(rankFiles(files, 'readme', 20)).toEqual(['README.md']);
    expect(rankFiles(files, '', 2)).toEqual(['src/hero/util.ts', 'src/components/Hero.tsx']);
    expect(rankFiles(files, 'hero', 1)).toEqual(['src/components/Hero.tsx']);
  });

  it('lists tracked and untracked files from git ls-files and caches them for 10s', async () => {
    const root = await gitRepo();
    await mkdir(path.join(root, 'src', 'components'), { recursive: true });
    await writeFile(path.join(root, 'src', 'components', 'Hero.tsx'), 'export const Hero = () => null;\n');
    await mkdir(path.join(root, 'src', 'hero'), { recursive: true });
    await writeFile(path.join(root, 'src', 'hero', 'util.ts'), 'export const n = 1;\n');
    await exec('git', ['add', '.'], { cwd: root });
    await exec('git', ['commit', '-m', 'files'], { cwd: root });
    await writeFile(path.join(root, 'notes.md'), 'todo\n');

    const found = await searchProjectFiles(root, 'hero');
    expect(found[0]).toBe('src/components/Hero.tsx');
    expect(found).toContain('src/hero/util.ts');
    expect(found).not.toContain('notes.md');

    const notes = await searchProjectFiles(root, 'notes');
    expect(notes).toEqual(['notes.md']);

    await writeFile(path.join(root, 'later.md'), 'cached\n');
    expect(await searchProjectFiles(root, 'later')).toEqual([]);
    resetFileSearchCache();
    expect(await searchProjectFiles(root, 'later')).toEqual(['later.md']);
  });

  it('answers files.search on the project WebSocket', async () => {
    const root = await gitRepo();
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'Hero.tsx'), 'export const Hero = () => null;\n');
    await exec('git', ['add', '.'], { cwd: root });
    await exec('git', ['commit', '-m', 'hero'], { cwd: root });
    const server = await startProject(root);
    const project = await register(server, root);
    const socket = await openSocket(projectWs(server, project.id, project.token));
    const messages = collect(socket);
    try {
      socket.send(JSON.stringify({ type: 'files.search', requestId: 's1', query: 'Hero', limit: 10 }));
      await messages.waitFor((items) => items.some((item) => item.requestId === 's1'));
      expect(messages.items.find((item) => item.requestId === 's1')).toMatchObject({
        type: 'files.search.result',
        files: ['src/Hero.tsx'],
      });
    } finally {
      await closeSocket(socket);
    }
  });
});

async function startProject(root: string): Promise<TestServer> {
  const server = await startTestServer({
    root,
    registerDefaultRoot: false,
    authenticateFetch: false,
    runtime: runtimeFor({
      cursor: new ScriptedAdapter('cursor', async () => ({ exitCode: 0, summary: '' })),
    }),
  });
  servers.push(server);
  return server;
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

async function gitRepo(): Promise<string> {
  const dir = await tempDir('fs-git-');
  await exec('git', ['init', '-b', 'main'], { cwd: dir });
  await exec('git', ['config', 'user.email', 'aidev@example.com'], { cwd: dir });
  await exec('git', ['config', 'user.name', 'Aidev Test'], { cwd: dir });
  await writeFile(path.join(dir, 'app.txt'), 'hello\n');
  await exec('git', ['add', '.'], { cwd: dir });
  await exec('git', ['commit', '-m', 'init'], { cwd: dir });
  return dir;
}

async function tempDir(prefix: string): Promise<string> {
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
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
