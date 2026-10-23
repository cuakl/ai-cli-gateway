import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { WorkspaceServerMessageSchema, createStreamEvent, type WorkspaceServerMessage } from '@aidev/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { isRecord, postJson, startTestServer, type TestServer } from './helpers.js';
import { runtimeFor, ScriptedAdapter } from './scripted-adapter.js';

const exec = promisify(execFile);
const dirs: string[] = [];
const servers: TestServer[] = [];

describe('workspace WebSocket', () => {
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('streams run.start and broadcasts project.activity', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const adapter = new ScriptedAdapter('cursor', async (ctx) => {
      ctx.onEvent(createStreamEvent(ctx.sessionId, 'chunk', { text: 'hello' }));
      await gate;
      ctx.onEvent(createStreamEvent(ctx.sessionId, 'done', { durationMs: 4 }));
      return { exitCode: 0, summary: 'hello' };
    });
    const root = await tempDir('ws-run-');
    const server = await startProject(root, adapter);
    const project = await register(server, root);
    const socket = await openSocket(projectWs(server, project.id, project.token));
    const messages = collect(socket);
    const watcher = await openSocket(projectWs(server, project.id, server.token));
    const activity = collect(watcher);
    try {
      socket.send(JSON.stringify(runStart('hello from the workspace')));
      await messages.waitFor((items) => items.some((item) => item.type === 'run.event'));
      expect(messages.items.map((item) => item.type)).toContain('run.accepted');
      expect(messages.items.find((item) => item.type === 'run.accepted')).toMatchObject({
        threadId: expect.stringMatching(/^thr_/),
        runId: expect.stringMatching(/^run_/),
      });
      await activity.waitFor((items) => items.some((item) => item.type === 'project.activity' && item.activeRuns === 1));
      release();
      await messages.waitFor((items) => items.some((item) => item.type === 'run.finished'));
      const finished = messages.items.find((item) => item.type === 'run.finished');
      expect(finished && finished.type === 'run.finished' && finished.run.status).toBe('succeeded');
      const events = messages.items.flatMap((item) => (item.type === 'run.event' ? [item.event] : []));
      expect(events.map((event) => event.type)).toEqual(['chunk', 'files_changed', 'done']);
      expect(events[0]?.payload.text).toBe('hello');
      await activity.waitFor((items) => {
        const counts = items.flatMap((item) => (item.type === 'project.activity' ? [item.activeRuns] : []));
        const started = counts.indexOf(1);
        return started >= 0 && counts.slice(started + 1).includes(0);
      });
      for (const item of messages.items) expect(WorkspaceServerMessageSchema.parse(item)).toEqual(item);
    } finally {
      release();
      await closeSocket(socket);
      await closeSocket(watcher);
    }
  });

  it('emits a segment -1 warning when the tree is dirty and does not start when it is conflicted', async () => {
    const adapter = new ScriptedAdapter('cursor', async (ctx) => {
      ctx.onEvent(createStreamEvent(ctx.sessionId, 'chunk', { text: 'edited' }));
      ctx.onEvent(createStreamEvent(ctx.sessionId, 'done', {}));
      return { exitCode: 0, summary: 'edited' };
    });
    const root = await gitRepo();
    await writeFile(path.join(root, 'app.txt'), 'hello\ndirty\n');
    const server = await startProject(root, adapter);
    const project = await register(server, root);
    const socket = await openSocket(projectWs(server, project.id, project.token));
    const messages = collect(socket);
    try {
      socket.send(JSON.stringify(runStart('touch the dirty tree')));
      await messages.waitFor((items) => items.some((item) => item.type === 'run.event' && item.event.type === 'chunk' && item.event.payload.segment === -1));
      const warning = messages.items.find((item) => item.type === 'run.event' && item.event.payload.segment === -1);
      expect(warning && warning.type === 'run.event' && warning.event.payload.text).toMatch(/uncommitted changes/);
      await messages.waitFor((items) => items.some((item) => item.type === 'run.finished'));
    } finally {
      await closeSocket(socket);
    }

    const conflicted = await gitRepo();
    await exec('git', ['checkout', '-b', 'side'], { cwd: conflicted });
    await writeFile(path.join(conflicted, 'app.txt'), 'side\n');
    await exec('git', ['add', '.'], { cwd: conflicted });
    await exec('git', ['commit', '-m', 'side'], { cwd: conflicted });
    await exec('git', ['checkout', 'main'], { cwd: conflicted });
    await writeFile(path.join(conflicted, 'app.txt'), 'main\n');
    await exec('git', ['add', '.'], { cwd: conflicted });
    await exec('git', ['commit', '-m', 'main'], { cwd: conflicted });
    await expect(exec('git', ['merge', 'side'], { cwd: conflicted })).rejects.toThrow();
    const conflictServer = await startProject(conflicted, adapter);
    const conflictProject = await register(conflictServer, conflicted);
    const conflictSocket = await openSocket(projectWs(conflictServer, conflictProject.id, conflictProject.token));
    const conflictMessages = collect(conflictSocket);
    try {
      conflictSocket.send(JSON.stringify(runStart('do not start')));
      await conflictMessages.waitFor((items) => items.some((item) => item.type === 'error'));
      expect(conflictMessages.items.find((item) => item.type === 'error')).toMatchObject({
        type: 'error',
        code: 'conflicted',
      });
      expect(conflictMessages.items.some((item) => item.type === 'run.accepted')).toBe(false);
    } finally {
      await closeSocket(conflictSocket);
    }
  });

  it('lists threads and rejects an invalid message', async () => {
    const root = await tempDir('ws-nyi-');
    const server = await startProject(
      root,
      new ScriptedAdapter('cursor', async () => ({ exitCode: 0, summary: '' })),
    );
    const project = await register(server, root);
    const socket = await openSocket(projectWs(server, project.id, project.token));
    const messages = collect(socket);
    try {
      socket.send(JSON.stringify({ type: 'thread.list', requestId: 't1' }));
      socket.send(JSON.stringify({ type: 'git.checkpoint.restore', requestId: 't2', runId: 'run_missingrunid1' }));
      socket.send(JSON.stringify({ type: 'nope', requestId: 'bad' }));
      await messages.waitFor((items) => items.filter((item) => item.requestId === 't1' || item.requestId === 't2' || item.requestId === 'bad').length >= 3);
      expect(messages.items.find((item) => item.requestId === 't1')).toMatchObject({
        type: 'thread.list.result',
        threads: [],
      });
      expect(messages.items.find((item) => item.requestId === 't2')).toMatchObject({
        type: 'error',
        code: 'not_found',
      });
      expect(messages.items.find((item) => item.requestId === 'bad')).toMatchObject({
        type: 'error',
        code: 'validation_error',
      });
    } finally {
      await closeSocket(socket);
    }
  });
});

function runStart(prompt: string): Record<string, unknown> {
  return {
    type: 'run.start',
    requestId: 'run-1',
    provider: 'cursor',
    mode: 'agent',
    prompt,
    context: { recentErrors: [], recentConsoleLogs: [], failedNetworkRequests: [] },
    attachments: [],
  };
}

async function startProject(root: string, adapter: ScriptedAdapter): Promise<TestServer> {
  const server = await startTestServer({
    root,
    registerDefaultRoot: false,
    authenticateFetch: false,
    runtime: runtimeFor({ cursor: adapter }),
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
  if (!isRecord(response.body) || typeof response.body.projectId !== 'string' || typeof response.body.browserToken !== 'string') {
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

async function tempDir(prefix: string): Promise<string> {
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
}

async function gitRepo(): Promise<string> {
  const dir = await tempDir('ws-git-');
  await exec('git', ['init', '-b', 'main'], { cwd: dir });
  await exec('git', ['config', 'user.email', 'aidev@example.com'], { cwd: dir });
  await exec('git', ['config', 'user.name', 'Aidev Test'], { cwd: dir });
  await writeFile(path.join(dir, 'app.txt'), 'hello\n');
  await exec('git', ['add', '.'], { cwd: dir });
  await exec('git', ['commit', '-m', 'init'], { cwd: dir });
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

function collect(socket: WebSocket): { items: WorkspaceServerMessage[]; waitFor: (ready: (items: WorkspaceServerMessage[]) => boolean) => Promise<void> } {
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
