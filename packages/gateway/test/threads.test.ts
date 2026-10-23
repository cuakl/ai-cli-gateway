import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createStreamEvent,
  type PromptOptions,
  type ProviderType,
  type ThreadEvent,
  type WorkspaceServerMessage,
} from '@aidev/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { collectThreadSse, isRecord, postJson, requestJson, startTestServer, waitFor, type TestServer } from './helpers.js';
import { runtimeFor, ScriptedAdapter } from './scripted-adapter.js';
import { previousConversation, PREVIOUS_CONVERSATION_MAX_BYTES } from '../src/threads/transcript.js';
import { FileThreadStore } from '../src/threads/store.js';
import { threadTitle } from '../src/threads/run.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const dirs: string[] = [];
const servers: TestServer[] = [];

describe('FileThreadStore', () => {
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('round-trips metadata and events and leaves no temp files after an atomic write', async () => {
    const home = await tempDir('thr-store-');
    const store = new FileThreadStore(home);
    const thread = await store.createThread({
      projectId: 'proj_a',
      provider: 'cursor',
      model: null,
      mode: 'agent',
      title: threadTitle('  keep   this title and cut it if it grows past eighty characters in one line  extra'),
      keep: true,
      source: 'overlay',
    });
    expect(thread.title.length).toBeLessThanOrEqual(80);
    expect(thread.title).toBe(threadTitle('  keep   this title and cut it if it grows past eighty characters in one line  extra'));
    expect(existsSync(path.join(home, 'threads', `${thread.id}.json`))).toBe(true);

    const run = {
      id: 'run_store1',
      threadId: thread.id,
      prompt: 'hello',
      contextSummary: null,
      attachments: [],
      status: 'running' as const,
      startedAt: 100,
      endedAt: null,
      checkpoint: null,
      filesTouched: [],
      error: null,
      usage: null,
    };
    await store.updateRun(thread.id, run);
    const event = createStreamEvent('sess_1', 'chunk', { text: 'hi' });
    await store.appendEvent(thread.id, run.id, event);
    const patched = await store.updateThread(thread.id, { providerSessionId: 'chat_1', model: 'gpt-test' });
    expect(patched.providerSessionId).toBe('chat_1');
    expect(patched.model).toBe('gpt-test');

    const names = await readdir(path.join(home, 'threads'));
    expect(names.every((name) => !name.endsWith('.tmp') && !name.startsWith('.'))).toBe(true);
    const raw = JSON.parse(await readFile(path.join(home, 'threads', `${thread.id}.json`), 'utf8')) as {
      thread: { id: string };
      runs: { id: string }[];
    };
    expect(raw.thread.id).toBe(thread.id);
    expect(raw.runs.map((item) => item.id)).toEqual([run.id]);

    const loaded = await store.getThread(thread.id);
    expect(loaded?.thread.providerSessionId).toBe('chat_1');
    expect(loaded?.runs).toHaveLength(1);
    const events = await store.readEvents(thread.id);
    expect(events).toEqual([{ runId: run.id, event }]);
    const listed = await store.listThreads({ projectId: 'proj_a', source: 'overlay', limit: 1 });
    expect(listed.map((item) => item.id)).toEqual([thread.id]);
  });

  it('purgeExpired deletes only old keep=false threads', async () => {
    const home = await tempDir('thr-purge-');
    const store = new FileThreadStore(home);
    const stale = await store.createThread(threadInput({ title: 'stale', keep: false }));
    const kept = await store.createThread(threadInput({ title: 'kept', keep: true }));
    const fresh = await store.createThread(threadInput({ title: 'fresh', keep: false }));
    const now = Date.now();
    await backdate(home, stale.id, now - 8 * DAY_MS);
    await backdate(home, kept.id, now - 8 * DAY_MS);
    const removed = await store.purgeExpired(7, now);
    expect(removed).toEqual([stale.id]);
    expect(await store.getThread(stale.id)).toBeUndefined();
    expect(await store.getThread(kept.id)).toBeDefined();
    expect(await store.getThread(fresh.id)).toBeDefined();
  });
});

describe('previousConversation', () => {
  it('keeps the last six turns and stays within 8 KB', () => {
    const turns = Array.from({ length: 8 }, (_, index) => ({
      user: `user ${index}`,
      assistant: `assistant ${index}`,
    }));
    const block = previousConversation(turns);
    expect(block).toContain('<previous_conversation>');
    expect(block).not.toContain('user 0');
    expect(block).not.toContain('user 1');
    expect(block).toContain('user 2');
    expect(block).toContain('user 7');

    const huge = previousConversation([
      { user: 'x'.repeat(20_000), assistant: 'y'.repeat(20_000) },
    ]);
    expect(huge).toBeDefined();
    expect(Buffer.byteLength(huge ?? '', 'utf8')).toBeLessThanOrEqual(PREVIOUS_CONVERSATION_MAX_BYTES);
    expect(huge?.startsWith('<previous_conversation>\n')).toBe(true);
    expect(huge?.endsWith('\n</previous_conversation>')).toBe(true);
  });
});

describe('thread HTTP, retention, and SSE', () => {
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('wraps legacy prompt and session routes as one-run api threads and filters the list', async () => {
    const seen: PromptOptions[] = [];
    const adapter = new ScriptedAdapter('cursor', async (ctx) => {
      seen.push(ctx.options);
      ctx.onEvent(createStreamEvent(ctx.sessionId, 'init', { text: 'started' }));
      ctx.onEvent(createStreamEvent(ctx.sessionId, 'chunk', { text: 'ok' }));
      ctx.onEvent(createStreamEvent(ctx.sessionId, 'done', { durationMs: 2 }));
      return { exitCode: 0, summary: 'ok' };
    });
    const root = await tempDir('thr-api-');
    const server = await startOn(root, { cursor: adapter });
    const headers = machineHeaders(server);

    const prompt = await postJson(
      `${server.url}/api/v1/prompt`,
      { provider: 'cursor', cwd: root, prompt: 'one shot', ephemeral: true, model: 'gpt-test', mode: 'ask' },
      { headers },
    );
    expect(prompt.status).toBe(200);
    expect(prompt.body).toMatchObject({ exitCode: 0, summary: 'ok' });
    expect(isRecord(prompt.body) && 'thread' in prompt.body).toBe(false);
    expect(seen[0]?.ephemeral).toBe(true);
    expect(seen[0]?.model).toBe('gpt-test');
    expect(seen[0]?.mode).toBe('ask');

    const created = await postJson(
      `${server.url}/api/v1/sessions`,
      { provider: 'cursor', cwd: root, prompt: 'session run' },
      { headers },
    );
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      status: 'running',
      streamUrl: expect.stringMatching(/^\/api\/v1\/sessions\/sess_/),
    });
    expect(isRecord(created.body) && typeof created.body.sessionId === 'string').toBe(true);

    const all = await requestJson(`${server.url}/api/v1/threads`, { headers });
    expect(all.status).toBe(200);
    const threads = threadList(all.body);
    expect(threads).toHaveLength(2);
    expect(threads.every((item) => item.source === 'api')).toBe(true);
    const ephemeral = threads.find((item) => item.title === 'one shot');
    const kept = threads.find((item) => item.title === 'session run');
    expect(ephemeral?.keep).toBe(false);
    expect(kept?.keep).toBe(true);

    const filtered = await requestJson(`${server.url}/api/v1/threads?source=overlay&limit=1`, { headers });
    expect(threadList(filtered.body)).toEqual([]);
    const limited = await requestJson(`${server.url}/api/v1/threads?source=api&limit=1`, { headers });
    expect(threadList(limited.body)).toHaveLength(1);

    const one = await requestJson(`${server.url}/api/v1/threads/${String(ephemeral?.id)}`, { headers });
    expect(one.status).toBe(200);
    expect(isRecord(one.body) && isRecord(one.body.thread) && Array.isArray(one.body.runs)).toBe(true);
    if (isRecord(one.body) && Array.isArray(one.body.runs)) {
      expect(one.body.runs).toHaveLength(1);
      expect(isRecord(one.body.runs[0]) && one.body.runs[0].status).toBe('succeeded');
    }
  });

  it('reloads threads and events after a buildServer restart', async () => {
    const home = await tempDir('thr-restart-home-');
    const root = await tempDir('thr-restart-root-');
    const adapter = echoAdapter('cursor', 'persisted');
    const first = await startOn(root, { cursor: adapter }, { home });
    const headers = machineHeaders(first);
    const created = await postJson(
      `${first.url}/api/v1/prompt`,
      { provider: 'cursor', cwd: root, prompt: 'remember this' },
      { headers },
    );
    expect(created.status).toBe(200);
    const listed = threadList((await requestJson(`${first.url}/api/v1/threads`, { headers })).body);
    expect(listed).toHaveLength(1);
    const threadId = listed[0]?.id;
    expect(threadId).toMatch(/^thr_/);
    await first.close();
    servers.splice(servers.indexOf(first), 1);

    const second = await startOn(root, { cursor: echoAdapter('cursor', 'later') }, { home });
    const again = machineHeaders(second);
    const loaded = await requestJson(`${second.url}/api/v1/threads/${String(threadId)}`, { headers: again });
    expect(loaded.status).toBe(200);
    expect(isRecord(loaded.body) && isRecord(loaded.body.thread) && loaded.body.thread.title).toBe('remember this');
    const stream = await fetch(`${second.url}/api/v1/threads/${String(threadId)}/events`, { headers: again });
    expect(stream.status).toBe(200);
    expect(stream.headers.get('content-type')).toContain('text/event-stream');
    const replayed = await collectThreadSse(stream);
    expect(replayed.map((item) => item.event.type)).toEqual(['init', 'chunk', 'files_changed', 'done']);
    expect(replayed[1]?.event.payload.text).toBe('persisted');
  });

  it('deletes only expired keep=false threads on startup', async () => {
    const home = await tempDir('thr-retain-home-');
    const store = new FileThreadStore(home);
    const stale = await store.createThread(threadInput({ title: 'old-ephemeral', keep: false, source: 'api' }));
    const kept = await store.createThread(threadInput({ title: 'old-keep', keep: true, source: 'api' }));
    const recent = await store.createThread(threadInput({ title: 'new-ephemeral', keep: false, source: 'api' }));
    const now = Date.now();
    await backdate(home, stale.id, now - 8 * DAY_MS);
    await backdate(home, kept.id, now - 8 * DAY_MS);
    const root = await tempDir('thr-retain-root-');
    const server = await startOn(root, { cursor: echoAdapter('cursor', 'x') }, { home });
    const listed = threadList((await requestJson(`${server.url}/api/v1/threads`, { headers: machineHeaders(server) })).body);
    const ids = listed.map((item) => item.id);
    expect(ids).not.toContain(stale.id);
    expect(ids).toEqual(expect.arrayContaining([kept.id, recent.id]));
  });

  it('replays stored events over SSE, then live events, and persists each line before broadcast', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const adapter = new ScriptedAdapter('cursor', async (ctx) => {
      ctx.onEvent(createStreamEvent(ctx.sessionId, 'init', { text: 'started' }));
      ctx.onEvent(createStreamEvent(ctx.sessionId, 'chunk', { text: 'early' }));
      await gate;
      ctx.onEvent(createStreamEvent(ctx.sessionId, 'chunk', { text: 'late' }));
      ctx.onEvent(createStreamEvent(ctx.sessionId, 'done', { durationMs: 3 }));
      return { exitCode: 0, summary: 'earlylate' };
    });
    const root = await tempDir('thr-sse-');
    const server = await startOn(root, { cursor: adapter });
    const headers = machineHeaders(server);
    const created = await postJson(
      `${server.url}/api/v1/sessions`,
      { provider: 'cursor', cwd: root, prompt: 'stream me' },
      { headers },
    );
    expect(created.status).toBe(201);
    const threadId = threadList((await requestJson(`${server.url}/api/v1/threads`, { headers })).body)[0]?.id;
    expect(threadId).toBeDefined();

    const received: ThreadEvent[] = [];
    const response = await fetch(`${server.url}/api/v1/threads/${String(threadId)}/events`, { headers });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const finished = collectThreadSse(response, (record) => received.push(record));
    await waitFor(() => received.some((item) => item.event.payload.text === 'early'));
    const earlyId = received.find((item) => item.event.payload.text === 'early')?.event.id;
    const stored = await jsonlLines(server.home, String(threadId));
    expect(stored.some((item) => item.event.id === earlyId)).toBe(true);
    release();
    const events = await finished;
    expect(events.map((item) => item.event.type)).toEqual(['init', 'chunk', 'chunk', 'files_changed', 'done']);
    expect(events[2]?.event.payload.text).toBe('late');
    expect(events.every((item) => item.runId.startsWith('run_'))).toBe(true);
  });

  it('stops a browser token from reading another project thread over HTTP', async () => {
    const adapter = echoAdapter('cursor', 'secret');
    const rootA = await tempDir('thr-http-a-');
    const rootB = await tempDir('thr-http-b-');
    const server = await startBare({ cursor: adapter });
    const machine = machineHeaders(server);
    const projectA = await register(server, rootA);
    const projectB = await register(server, rootB);
    const created = await postJson(
      `${server.url}/api/v1/prompt`,
      { provider: 'cursor', cwd: rootB, prompt: 'project b only' },
      { headers: machine },
    );
    expect(created.status).toBe(200);
    const threadId = threadList((await requestJson(`${server.url}/api/v1/threads?projectId=${projectB.id}`, { headers: machine })).body)[0]?.id;
    expect(threadId).toBeDefined();

    const headersA = { authorization: `Bearer ${projectA.token}` };
    const listed = await requestJson(`${server.url}/api/v1/threads?projectId=${projectB.id}`, { headers: headersA });
    expect(listed.status).toBe(403);
    const ownList = await requestJson(`${server.url}/api/v1/threads`, { headers: headersA });
    expect(threadList(ownList.body)).toEqual([]);
    const got = await requestJson(`${server.url}/api/v1/threads/${String(threadId)}`, { headers: headersA });
    expect(got.status).toBe(403);
    const events = await requestJson(`${server.url}/api/v1/threads/${String(threadId)}/events`, { headers: headersA });
    expect(events.status).toBe(403);
    const deleted = await requestJson(`${server.url}/api/v1/threads/${String(threadId)}`, {
      method: 'DELETE',
      headers: headersA,
    });
    expect(deleted.status).toBe(403);
  });
});

describe('workspace threads', () => {
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('passes a captured providerSessionId on follow-up for a resume provider', async () => {
    const seen: PromptOptions[] = [];
    const adapter = new ScriptedAdapter('cursor', async (ctx) => {
      seen.push(ctx.options);
      ctx.onEvent(createStreamEvent(ctx.sessionId, 'session_info', { providerSessionId: 'chat_cursor_1', model: 'gpt-test' }));
      ctx.onEvent(createStreamEvent(ctx.sessionId, 'chunk', { text: 'first' }));
      ctx.onEvent(createStreamEvent(ctx.sessionId, 'done', { durationMs: 2 }));
      return { exitCode: 0, summary: 'first' };
    });
    const root = await tempDir('thr-resume-');
    const server = await startOn(root, { cursor: adapter });
    const project = await register(server, root);
    const socket = await openSocket(projectWs(server, project.id, project.token));
    const messages = collect(socket);
    try {
      socket.send(JSON.stringify(runStart('paint it blue', { requestId: 'r1', model: 'gpt-test', mode: 'agent' })));
      await messages.waitFor((items) => items.some((item) => item.type === 'run.finished' && item.requestId === 'r1'));
      const accepted = messages.items.find((item) => item.type === 'run.accepted' && item.requestId === 'r1');
      expect(accepted && accepted.type === 'run.accepted' && accepted.threadId).toMatch(/^thr_/);
      const threadId = accepted && accepted.type === 'run.accepted' ? accepted.threadId : '';
      socket.send(JSON.stringify(runStart('now the title', { requestId: 'r2', threadId, model: 'gpt-test', mode: 'ask' })));
      await messages.waitFor((items) => items.some((item) => item.type === 'run.finished' && item.requestId === 'r2'));
      expect(seen).toHaveLength(2);
      expect(seen[0]?.providerSessionId).toBeUndefined();
      expect(seen[0]?.model).toBe('gpt-test');
      expect(seen[0]?.mode).toBe('agent');
      expect(seen[1]?.providerSessionId).toBe('chat_cursor_1');
      expect(seen[1]?.model).toBe('gpt-test');
      expect(seen[1]?.mode).toBe('ask');
      expect(seen[1]?.prompt).not.toContain('<previous_conversation>');

      socket.send(JSON.stringify({ type: 'thread.get', requestId: 'g1', threadId }));
      socket.send(JSON.stringify({ type: 'thread.keep', requestId: 'k1', threadId, keep: false }));
      await messages.waitFor((items) => items.some((item) => item.requestId === 'g1') && items.some((item) => item.requestId === 'k1'));
      const got = messages.items.find((item) => item.requestId === 'g1');
      expect(got).toMatchObject({ type: 'thread.get.result' });
      if (got && got.type === 'thread.get.result') {
        expect(got.thread.providerSessionId).toBe('chat_cursor_1');
        expect(got.runs).toHaveLength(2);
        expect(got.events.length).toBeGreaterThan(0);
      }
      expect(messages.items.find((item) => item.requestId === 'k1')).toMatchObject({
        type: 'thread.keep.result',
        thread: { keep: false },
      });
    } finally {
      await closeSocket(socket);
    }
  });

  it('prepends a transcript for a provider that cannot resume', async () => {
    const seen: PromptOptions[] = [];
    const adapter = new ScriptedAdapter('antigravity', async (ctx) => {
      seen.push(ctx.options);
      ctx.onEvent(createStreamEvent(ctx.sessionId, 'session_info', { providerSessionId: 'agy_1' }));
      ctx.onEvent(createStreamEvent(ctx.sessionId, 'chunk', { text: 'the hero is blue' }));
      ctx.onEvent(createStreamEvent(ctx.sessionId, 'done', { durationMs: 2 }));
      return { exitCode: 0, summary: 'the hero is blue' };
    });
    const root = await tempDir('thr-transcript-');
    const server = await startOn(root, { antigravity: adapter });
    const project = await register(server, root);
    const socket = await openSocket(projectWs(server, project.id, project.token));
    const messages = collect(socket);
    try {
      socket.send(JSON.stringify(runStart('describe the hero', { requestId: 'r1', provider: 'antigravity' })));
      await messages.waitFor((items) => items.some((item) => item.type === 'run.finished' && item.requestId === 'r1'));
      const accepted = messages.items.find((item) => item.type === 'run.accepted' && item.requestId === 'r1');
      const threadId = accepted && accepted.type === 'run.accepted' ? accepted.threadId : '';
      socket.send(JSON.stringify(runStart('make it red', { requestId: 'r2', threadId, provider: 'antigravity' })));
      await messages.waitFor((items) => items.some((item) => item.type === 'run.finished' && item.requestId === 'r2'));
      expect(seen[1]?.providerSessionId).toBeUndefined();
      expect(seen[1]?.prompt).toContain('<previous_conversation>');
      expect(seen[1]?.prompt).toContain('describe the hero');
      expect(seen[1]?.prompt).toContain('the hero is blue');
      expect(seen[1]?.prompt).toContain('make it red');
    } finally {
      await closeSocket(socket);
    }
  });

  it('rejects a workspace thread.get for another project and cancels an active run on delete', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const hanging = new ScriptedAdapter('cursor', async (ctx) => {
      ctx.onEvent(createStreamEvent(ctx.sessionId, 'chunk', { text: 'working' }));
      await Promise.race([ctx.waitUntilKilled(), gate]);
      ctx.onEvent(createStreamEvent(ctx.sessionId, 'done', {}));
      return { exitCode: ctx.wasKilled() ? 1 : 0, summary: '' };
    });
    const rootA = await tempDir('thr-ws-a-');
    const rootB = await tempDir('thr-ws-b-');
    const server = await startBare({ cursor: hanging });
    const projectA = await register(server, rootA);
    const projectB = await register(server, rootB);
    const socketB = await openSocket(projectWs(server, projectB.id, projectB.token));
    const socketA = await openSocket(projectWs(server, projectA.id, projectA.token));
    const messagesB = collect(socketB);
    const messagesA = collect(socketA);
    try {
      socketB.send(JSON.stringify(runStart('hang please', { requestId: 'hang' })));
      await messagesB.waitFor((items) => items.some((item) => item.type === 'run.event' && item.event.payload.text === 'working'));
      const accepted = messagesB.items.find((item) => item.type === 'run.accepted');
      const threadId = accepted && accepted.type === 'run.accepted' ? accepted.threadId : '';
      expect(threadId).toMatch(/^thr_/);

      socketA.send(JSON.stringify({ type: 'thread.get', requestId: 'cross', threadId }));
      await messagesA.waitFor((items) => items.some((item) => item.requestId === 'cross'));
      expect(messagesA.items.find((item) => item.requestId === 'cross')).toMatchObject({
        type: 'error',
        code: 'not_found',
      });

      socketB.send(JSON.stringify({ type: 'thread.delete', requestId: 'del', threadId }));
      await messagesB.waitFor((items) => items.some((item) => item.requestId === 'del'));
      expect(messagesB.items.find((item) => item.requestId === 'del')).toMatchObject({
        type: 'thread.delete.result',
        threadId,
      });
      expect(hanging.kills.length).toBeGreaterThan(0);
      expect(existsSync(path.join(server.home, 'threads', `${threadId}.json`))).toBe(false);
      expect(existsSync(path.join(server.home, 'threads', `${threadId}.jsonl`))).toBe(false);
      const missing = await requestJson(`${server.url}/api/v1/threads/${threadId}`, { headers: machineHeaders(server) });
      expect(missing.status).toBe(404);
    } finally {
      release();
      await closeSocket(socketA);
      await closeSocket(socketB);
    }
  });
});

function threadInput(overrides: { title: string; keep: boolean; source?: 'overlay' | 'api' }) {
  return {
    projectId: 'proj_x',
    provider: 'cursor' as const,
    model: null,
    mode: 'agent' as const,
    title: overrides.title,
    keep: overrides.keep,
    source: overrides.source ?? 'overlay',
  };
}

function echoAdapter(provider: ProviderType, text: string): ScriptedAdapter {
  return new ScriptedAdapter(provider, async (ctx) => {
    ctx.onEvent(createStreamEvent(ctx.sessionId, 'init', { text: 'started' }));
    ctx.onEvent(createStreamEvent(ctx.sessionId, 'chunk', { text }));
    ctx.onEvent(createStreamEvent(ctx.sessionId, 'done', { durationMs: 2 }));
    return { exitCode: 0, summary: text };
  });
}

function machineHeaders(server: TestServer): { authorization: string } {
  return { authorization: `Bearer ${server.token}` };
}

function threadList(body: unknown): Array<{ id: string; title: string; keep: boolean; source: string }> {
  if (!isRecord(body) || !Array.isArray(body.threads)) return [];
  return body.threads.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.title !== 'string') return [];
    return [
      {
        id: item.id,
        title: item.title,
        keep: item.keep === true,
        source: typeof item.source === 'string' ? item.source : '',
      },
    ];
  });
}

async function jsonlLines(home: string, threadId: string): Promise<ThreadEvent[]> {
  const file = path.join(home, 'threads', `${threadId}.jsonl`);
  if (!existsSync(file)) return [];
  const raw = await readFile(file, 'utf8');
  return raw
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as ThreadEvent);
}

async function backdate(home: string, threadId: string, updatedAt: number): Promise<void> {
  const file = path.join(home, 'threads', `${threadId}.json`);
  const raw = JSON.parse(await readFile(file, 'utf8')) as { thread: { updatedAt: number } };
  raw.thread.updatedAt = updatedAt;
  await writeFile(file, `${JSON.stringify(raw, null, 2)}\n`);
}

async function startOn(
  root: string,
  adapters: Partial<Record<ProviderType, ScriptedAdapter>>,
  options: { home?: string } = {},
): Promise<TestServer> {
  const server = await startTestServer({
    root,
    home: options.home,
    registerDefaultRoot: false,
    authenticateFetch: false,
    runtime: runtimeFor(adapters),
  });
  servers.push(server);
  return server;
}

async function startBare(adapters: Partial<Record<ProviderType, ScriptedAdapter>>): Promise<TestServer> {
  const server = await startTestServer({
    registerDefaultRoot: false,
    authenticateFetch: false,
    runtime: runtimeFor(adapters),
  });
  servers.push(server);
  return server;
}

async function register(server: TestServer, root: string): Promise<{ id: string; token: string }> {
  const response = await postJson(
    `${server.url}/api/v1/projects/register`,
    { root, origin: `http://localhost:${Math.floor(Math.random() * 1000) + 5000}` },
    { headers: machineHeaders(server) },
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
