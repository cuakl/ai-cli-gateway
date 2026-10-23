import { execFile } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { createStreamEvent, type WorkspaceServerMessage } from '@aidev/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { defaultConfig, writeConfig } from '../src/home.js';
import { checkpointRef } from '../src/workspace/git-service.js';
import { isRecord, postJson, requestJson, startTestServer, type TestServer } from './helpers.js';
import { runtimeFor, ScriptedAdapter } from './scripted-adapter.js';

const exec = promisify(execFile);
const dirs: string[] = [];
const servers: TestServer[] = [];

describe('checkpoints, restore, and run queue', () => {
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('undoes only the agent edits on a dirty tree and keeps untracked user files', async () => {
    const root = await gitRepo();
    await writeFile(path.join(root, 'app.txt'), 'hello\nuser\n');
    await writeFile(path.join(root, 'notes.txt'), 'scratch\n');
    await writeFile(path.join(root, 'keep.txt'), 'mine\n');
    const adapter = new ScriptedAdapter('cursor', async (ctx) => {
      await writeFile(path.join(ctx.options.cwd, 'app.txt'), 'hello\nuser\nagent\n');
      await writeFile(path.join(ctx.options.cwd, 'agent.txt'), 'created\n');
      ctx.onEvent(createStreamEvent(ctx.sessionId, 'file_edit', { filePath: 'app.txt' }));
      ctx.onEvent(createStreamEvent(ctx.sessionId, 'file_edit', { filePath: 'agent.txt' }));
      ctx.onEvent(createStreamEvent(ctx.sessionId, 'done', {}));
      return { exitCode: 0, summary: 'edited' };
    });
    const server = await startProject(root, adapter);
    const project = await register(server, root);
    const socket = await openSocket(projectWs(server, project.id, project.token));
    const messages = collect(socket);
    try {
      socket.send(JSON.stringify(runStart('edit files')));
      await messages.waitFor((items) => items.some((item) => item.type === 'run.finished'));
      const types = eventTypes(messages.items);
      const filesChangedAt = types.lastIndexOf('files_changed');
      const doneAt = types.lastIndexOf('done');
      expect(types).toContain('checkpoint');
      expect(filesChangedAt).toBeGreaterThanOrEqual(0);
      expect(doneAt).toBe(filesChangedAt + 1);
      const finished = messages.items.find((item) => item.type === 'run.finished');
      expect(finished?.type).toBe('run.finished');
      if (finished && finished.type === 'run.finished') {
        expect([...finished.run.filesTouched].sort()).toEqual(['agent.txt', 'app.txt']);
      }
      expect(await readFile(path.join(root, 'app.txt'), 'utf8')).toBe('hello\nuser\nagent\n');

      const runId = finished && finished.type === 'run.finished' ? finished.run.id : '';
      socket.send(JSON.stringify({ type: 'git.checkpoint.restore', requestId: 'undo', runId }));
      await messages.waitFor((items) => items.some((item) => item.requestId === 'undo'));
      expect(messages.items.find((item) => item.requestId === 'undo')).toMatchObject({
        type: 'git.checkpoint.restore.result',
        files: expect.arrayContaining(['app.txt', 'agent.txt']),
      });
      expect(await readFile(path.join(root, 'app.txt'), 'utf8')).toBe('hello\nuser\n');
      expect(await readFile(path.join(root, 'notes.txt'), 'utf8')).toBe('scratch\n');
      expect(await readFile(path.join(root, 'keep.txt'), 'utf8')).toBe('mine\n');
      await expect(readFile(path.join(root, 'agent.txt'))).rejects.toThrow();
    } finally {
      await closeSocket(socket);
    }
  });

  it('refuses restore when a newer run touched the same files unless force is set', async () => {
    const root = await gitRepo();
    const adapter = new ScriptedAdapter('cursor', async (ctx) => {
      const current = await readFile(path.join(ctx.options.cwd, 'app.txt'), 'utf8');
      await writeFile(path.join(ctx.options.cwd, 'app.txt'), `${current.trimEnd()}\n${ctx.options.prompt}\n`);
      ctx.onEvent(createStreamEvent(ctx.sessionId, 'file_edit', { filePath: 'app.txt' }));
      ctx.onEvent(createStreamEvent(ctx.sessionId, 'done', {}));
      return { exitCode: 0, summary: ctx.options.prompt };
    });
    const server = await startProject(root, adapter);
    const project = await register(server, root);
    const socket = await openSocket(projectWs(server, project.id, project.token));
    const messages = collect(socket);
    try {
      socket.send(JSON.stringify(runStart('first', { requestId: 'r1' })));
      await messages.waitFor((items) => items.some((item) => item.type === 'run.finished' && item.requestId === 'r1'));
      socket.send(JSON.stringify(runStart('second', { requestId: 'r2' })));
      await messages.waitFor((items) => items.some((item) => item.type === 'run.finished' && item.requestId === 'r2'));
      const first = messages.items.find((item) => item.type === 'run.finished' && item.requestId === 'r1');
      const firstId = first && first.type === 'run.finished' ? first.run.id : '';

      socket.send(JSON.stringify({ type: 'git.checkpoint.restore', requestId: 'u1', runId: firstId }));
      await messages.waitFor((items) => items.some((item) => item.requestId === 'u1'));
      expect(messages.items.find((item) => item.requestId === 'u1')).toMatchObject({
        type: 'error',
        code: 'conflict_newer_run',
      });
      expect(await readFile(path.join(root, 'app.txt'), 'utf8')).toContain('second');

      socket.send(JSON.stringify({ type: 'git.checkpoint.restore', requestId: 'u2', runId: firstId, force: true }));
      await messages.waitFor((items) => items.some((item) => item.requestId === 'u2'));
      expect(messages.items.find((item) => item.requestId === 'u2')).toMatchObject({
        type: 'git.checkpoint.restore.result',
        runId: firstId,
      });
      expect(await readFile(path.join(root, 'app.txt'), 'utf8')).toBe('hello\n');
    } finally {
      await closeSocket(socket);
    }
  });

  it('queues extra agent runs FIFO and reports queuedRuns', async () => {
    const started: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const adapter = new ScriptedAdapter('cursor', async (ctx) => {
      const name = ctx.options.prompt.split('\n')[0] ?? ctx.options.prompt;
      started.push(name);
      ctx.onEvent(createStreamEvent(ctx.sessionId, 'chunk', { text: name }));
      if (name === 'one') await gate;
      ctx.onEvent(createStreamEvent(ctx.sessionId, 'done', {}));
      return { exitCode: 0, summary: name };
    });
    const root = await gitRepo();
    const server = await startProject(root, adapter);
    const project = await register(server, root);
    const socket = await openSocket(projectWs(server, project.id, project.token));
    const messages = collect(socket);
    try {
      socket.send(JSON.stringify(runStart('one', { requestId: 'a' })));
      await messages.waitFor((items) => items.some((item) => item.type === 'run.event' && item.event.payload.text === 'one'));
      socket.send(JSON.stringify(runStart('two', { requestId: 'b' })));
      await messages.waitFor((items) => items.some((item) => item.type === 'run.accepted' && item.requestId === 'b'));
      socket.send(JSON.stringify(runStart('three', { requestId: 'c' })));
      await messages.waitFor((items) => items.some((item) => item.type === 'run.accepted' && item.requestId === 'c'));
      await messages.waitFor((items) =>
        items.some((item) => item.type === 'project.activity' && (item.queuedRuns ?? 0) >= 2),
      );
      expect(started).toEqual(['one']);
      release();
      await messages.waitFor((items) => items.filter((item) => item.type === 'run.finished').length >= 3);
      expect(started).toEqual(['one', 'two', 'three']);
    } finally {
      release();
      await closeSocket(socket);
    }
  });

  it('returns 429 with Retry-After when HTTP runs exceed maxConcurrentRuns', async () => {
    const home = await tempDir('ckpt-home-');
    await writeConfig(home, { ...defaultConfig(), maxConcurrentRuns: 1 });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const adapter = new ScriptedAdapter('cursor', async (ctx) => {
      if (ctx.options.prompt === 'hold') await gate;
      ctx.onEvent(createStreamEvent(ctx.sessionId, 'chunk', { text: ctx.options.prompt }));
      ctx.onEvent(createStreamEvent(ctx.sessionId, 'done', {}));
      return { exitCode: 0, summary: ctx.options.prompt };
    });
    const root = await gitRepo();
    const server = await startTestServer({
      home,
      root,
      registerDefaultRoot: false,
      authenticateFetch: false,
      runtime: runtimeFor({ cursor: adapter }),
    });
    servers.push(server);
    const headers = { authorization: `Bearer ${server.token}` };
    try {
      const hanging = await postJson(
        `${server.url}/api/v1/sessions`,
        { provider: 'cursor', cwd: root, prompt: 'hold' },
        { headers },
      );
      expect(hanging.status).toBe(201);
      const blocked = await postJson(
        `${server.url}/api/v1/prompt`,
        { provider: 'cursor', cwd: root, prompt: 'nope' },
        { headers },
      );
      expect(blocked.status).toBe(429);
      expect(blocked.body).toMatchObject({ error: 'too_many_runs' });
      expect(blocked.headers.get('retry-after')).toBe('5');
    } finally {
      release();
    }
  });

  it('restores over HTTP and prunes checkpoint refs when the thread is deleted', async () => {
    const root = await gitRepo();
    const adapter = new ScriptedAdapter('cursor', async (ctx) => {
      await writeFile(path.join(ctx.options.cwd, 'app.txt'), 'hello\nagent\n');
      ctx.onEvent(createStreamEvent(ctx.sessionId, 'file_edit', { filePath: 'app.txt' }));
      ctx.onEvent(createStreamEvent(ctx.sessionId, 'done', {}));
      return { exitCode: 0, summary: 'edited' };
    });
    const server = await startProject(root, adapter);
    const project = await register(server, root);
    const headers = { authorization: `Bearer ${server.token}` };
    const created = await postJson(
      `${server.url}/api/v1/prompt`,
      { provider: 'cursor', cwd: root, prompt: 'paint it' },
      { headers },
    );
    expect(created.status).toBe(200);
    const listed = await requestJson(`${server.url}/api/v1/threads`, { headers });
    const threadId = isRecord(listed.body) && Array.isArray(listed.body.threads)
      ? String((listed.body.threads[0] as { id: string }).id)
      : '';
    const got = await requestJson(`${server.url}/api/v1/threads/${threadId}`, { headers });
    expect(isRecord(got.body) && Array.isArray(got.body.runs)).toBe(true);
    const run = isRecord(got.body) && Array.isArray(got.body.runs) ? got.body.runs[0] : undefined;
    expect(isRecord(run) && typeof run.id === 'string').toBe(true);
    const runId = isRecord(run) ? String(run.id) : '';
    const refs = await exec('git', ['show-ref', checkpointRef(runId)], { cwd: root });
    expect(refs.stdout).toContain(checkpointRef(runId));

    const restored = await postJson(`${server.url}/api/v1/runs/${runId}/restore`, {}, { headers });
    expect(restored.status).toBe(200);
    expect(restored.body).toMatchObject({ runId, files: ['app.txt'] });
    expect(await readFile(path.join(root, 'app.txt'), 'utf8')).toBe('hello\n');

    const deleted = await requestJson(`${server.url}/api/v1/threads/${threadId}`, { method: 'DELETE', headers });
    expect(deleted.status).toBe(200);
    await expect(exec('git', ['show-ref', '--verify', checkpointRef(runId)], { cwd: root })).rejects.toThrow();
  });
});

function eventTypes(items: WorkspaceServerMessage[]): string[] {
  return items.flatMap((item) => (item.type === 'run.event' ? [item.event.type] : []));
}

function runStart(prompt: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'run.start',
    requestId: 'run-1',
    provider: 'cursor',
    mode: 'agent',
    prompt,
    context: { recentErrors: [], recentConsoleLogs: [], failedNetworkRequests: [] },
    attachments: [],
    ...extra,
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

async function gitRepo(): Promise<string> {
  const dir = await tempDir('ckpt-git-');
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
        if (Date.now() - started > 8_000) throw new Error(`messages: ${JSON.stringify(items)}`);
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
    },
  };
}
