import { chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { BinaryNotFoundError, BinaryResolver, createAdapter, type CLIAdapter } from '@gateway/core';
import { createStreamEvent, type PromptOptions, type UnifiedStreamEvent } from '@gateway/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collectSse, isRecord, postJson, requestJson, startTestServer, waitFor } from './helpers.js';
import { runtimeFor, ScriptedAdapter } from './scripted-adapter.js';

const cursorFixture = fileURLToPath(
  new URL('../../gateway-core/test/adapters/fixtures/mock-cursor.js', import.meta.url),
);
const hangFixture = fileURLToPath(
  new URL('../../gateway-core/test/adapters/fixtures/mock-hang.js', import.meta.url),
);

describe('GET /health and GET /api/v1/providers', () => {
  let url = '';
  let close: () => Promise<void> = async () => {};

  beforeAll(async () => {
    const server = await startTestServer();
    url = server.url;
    close = server.close;
  });

  afterAll(async () => {
    await close();
  });

  it('reports gateway status and detected providers', async () => {
    const health = await requestJson(`${url}/health`);
    expect(health.status).toBe(200);
    expect(isRecord(health.body)).toBe(true);
    if (!isRecord(health.body)) return;
    expect(health.body.status).toBe('ok');
    expect(typeof health.body.timestamp).toBe('number');
    const providers = health.body.availableProviders;
    expect(Array.isArray(providers)).toBe(true);
    if (!Array.isArray(providers)) return;
    expect(providers.map((item) => (isRecord(item) ? item.provider : null))).toEqual([
      'cursor',
      'antigravity',
      'claude',
      'codex',
    ]);
    for (const item of providers) {
      expect(isRecord(item)).toBe(true);
      if (!isRecord(item)) continue;
      expect(typeof item.available).toBe('boolean');
      expect(item.available).toBe(item.binaryPath !== null);
    }
  });

  it('lists resolved binary paths', async () => {
    const listed = await requestJson(`${url}/api/v1/providers`);
    const health = await requestJson(`${url}/health`);
    expect(listed.status).toBe(200);
    expect(isRecord(listed.body)).toBe(true);
    expect(isRecord(health.body)).toBe(true);
    if (!isRecord(listed.body) || !isRecord(health.body)) return;
    expect(listed.body.providers).toEqual(health.body.availableProviders);
  });

  it('reflects the request origin', async () => {
    const health = await requestJson(`${url}/health`, {
      headers: { origin: 'http://localhost:5173' },
    });
    expect(health.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });
});

describe('POST /api/v1/prompt', () => {
  it('rejects an invalid body', async () => {
    const adapter = scriptedEcho();
    const server = await startTestServer({ runtime: runtimeFor({ cursor: adapter }) });
    try {
      const response = await postJson(`${server.url}/api/v1/prompt`, {});
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ error: 'validation_error' });
    } finally {
      await server.close();
    }
  });

  it('returns a structured error when the provider CLI is missing', async () => {
    const server = await startTestServer({
      runtime: runtimeFor({ antigravity: new MissingAntigravity() }),
    });
    try {
      const response = await postJson(`${server.url}/api/v1/prompt`, {
        provider: 'antigravity',
        cwd: tmpdir(),
        prompt: 'hello',
      });
      expect(response.status).toBe(422);
      expect(isRecord(response.body)).toBe(true);
      if (!isRecord(response.body)) return;
      expect(response.body.error).toBe('provider_unavailable');
      expect(response.body.message).toEqual(expect.stringContaining('agy'));
    } finally {
      await server.close();
    }
  });

  it('waits for the adapter and returns the exit code, summary, and events', async () => {
    const adapter = scriptedEcho();
    const server = await startTestServer({ runtime: runtimeFor({ cursor: adapter }) });
    try {
      const response = await postJson(`${server.url}/api/v1/prompt`, {
        provider: 'cursor',
        cwd: tmpdir(),
        prompt: 'hello',
      });
      expect(response.status).toBe(200);
      expect(isRecord(response.body)).toBe(true);
      if (!isRecord(response.body)) return;
      expect(response.body.exitCode).toBe(0);
      expect(response.body.summary).toBe('hello world');
      expect(eventTypes(response.body.events)).toEqual(['init', 'chunk', 'chunk', 'done']);
      const events = response.body.events;
      if (!Array.isArray(events) || !isRecord(events[1]) || !isRecord(events[2])) return;
      expect(isRecord(events[1].payload) && events[1].payload.text).toBe('hello ');
      expect(isRecord(events[2].payload) && events[2].payload.text).toBe('world');
    } finally {
      await server.close();
    }
  });

  it('runs the cursor adapter against a mock CLI binary', async () => {
    await chmod(cursorFixture, 0o755);
    const adapter = adapterWithBinary('cursor', cursorFixture);
    const server = await startTestServer({ runtime: runtimeFor({ cursor: adapter }) });
    try {
      const response = await postJson(`${server.url}/api/v1/prompt`, {
        provider: 'cursor',
        cwd: tmpdir(),
        prompt: 'update the hero button',
      });
      expect(response.status).toBe(200);
      expect(isRecord(response.body)).toBe(true);
      if (!isRecord(response.body)) return;
      expect(response.body.exitCode).toBe(0);
      expect(response.body.summary).toEqual(expect.stringContaining('Updated hero button'));
      const types = eventTypes(response.body.events);
      expect(types[0]).toBe('init');
      expect(types).toContain('chunk');
      expect(types).toContain('file_edit');
      expect(types).toContain('done');
    } finally {
      await server.close();
    }
  });
});

describe('sessions and SSE', () => {
  it('replays events that were emitted before the client subscribed', async () => {
    const adapter = new ScriptedAdapter('antigravity', async ({ onEvent, sessionId }) => {
      onEvent(createStreamEvent(sessionId, 'init', { text: 'Antigravity session started' }));
      onEvent(createStreamEvent(sessionId, 'chunk', { text: 'buffered' }));
      onEvent(createStreamEvent(sessionId, 'done', { durationMs: 3 }));
      return { exitCode: 0, summary: 'buffered' };
    });
    const server = await startTestServer({ runtime: runtimeFor({ antigravity: adapter }) });
    try {
      const created = await postJson(`${server.url}/api/v1/sessions`, {
        provider: 'antigravity',
        cwd: tmpdir(),
        prompt: 'say hello',
      });
      expect(created.status).toBe(201);
      expect(isRecord(created.body)).toBe(true);
      if (!isRecord(created.body)) return;
      const sessionId = created.body.sessionId;
      expect(sessionId).toEqual(expect.stringMatching(/^sess_/));
      expect(created.body).toMatchObject({
        status: 'running',
        streamUrl: `/api/v1/sessions/${String(sessionId)}/stream`,
      });

      const response = await fetch(`${server.url}/api/v1/sessions/${String(sessionId)}/stream`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      expect(response.headers.get('cache-control')).toContain('no-cache');
      const raw = await response.text();
      expect(raw).toContain('event: init\n');
      expect(raw).toContain('event: chunk\n');
      expect(raw).toContain('event: done\n');
      const events = parseAll(raw);
      expect(events.map((event) => event.type)).toEqual(['init', 'chunk', 'done']);
      expect(events[1]?.payload.text).toBe('buffered');

      await waitFor(async () => {
        const current = await requestJson(`${server.url}/api/v1/sessions/${String(sessionId)}`);
        return isRecord(current.body) && current.body.status === 'completed';
      });
      const record = await requestJson(`${server.url}/api/v1/sessions/${String(sessionId)}`);
      expect(record.body).toMatchObject({ id: sessionId, provider: 'antigravity', status: 'completed', exitCode: 0 });
    } finally {
      await server.close();
    }
  });

  it('streams events that arrive after the subscriber connects', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const adapter = new ScriptedAdapter('cursor', async ({ onEvent, sessionId }) => {
      onEvent(createStreamEvent(sessionId, 'init', { text: 'started' }));
      onEvent(createStreamEvent(sessionId, 'chunk', { text: 'early' }));
      await gate;
      onEvent(createStreamEvent(sessionId, 'chunk', { text: 'late' }));
      onEvent(createStreamEvent(sessionId, 'done', { durationMs: 1 }));
      return { exitCode: 0, summary: 'earlylate' };
    });
    const server = await startTestServer({ runtime: runtimeFor({ cursor: adapter }) });
    try {
      const created = await postJson(`${server.url}/api/v1/sessions`, {
        provider: 'cursor',
        cwd: tmpdir(),
        prompt: 'stream',
      });
      if (!isRecord(created.body)) throw new Error('expected session body');
      const sessionId = String(created.body.sessionId);
      const response = await fetch(`${server.url}/api/v1/sessions/${sessionId}/stream`);
      const received: UnifiedStreamEvent[] = [];
      const finished = collectSse(response, (event) => received.push(event));
      await waitFor(() => received.some((event) => event.payload.text === 'early'));
      expect(received.map((event) => event.type)).toEqual(['init', 'chunk']);
      expect(received.map((event) => event.payload.text)).toEqual(['started', 'early']);
      release();
      const events = await finished;
      expect(events.map((event) => event.type)).toEqual(['init', 'chunk', 'chunk', 'done']);
      expect(events[2]?.payload.text).toBe('late');
    } finally {
      release();
      await server.close();
    }
  });

  it('cancels a running CLI when the session is deleted', async () => {
    await chmod(hangFixture, 0o755);
    const adapter = adapterWithBinary('cursor', hangFixture);
    const server = await startTestServer({ runtime: runtimeFor({ cursor: adapter }) });
    try {
      const created = await postJson(`${server.url}/api/v1/sessions`, {
        provider: 'cursor',
        cwd: tmpdir(),
        prompt: 'hang',
        timeoutMs: 8_000,
      });
      expect(created.status).toBe(201);
      if (!isRecord(created.body)) throw new Error('expected session body');
      const sessionId = String(created.body.sessionId);

      const response = await fetch(`${server.url}/api/v1/sessions/${sessionId}/stream`);
      const received: UnifiedStreamEvent[] = [];
      const finished = collectSse(response, (event) => received.push(event));
      await waitFor(() => received.some((event) => event.type === 'init'));

      const deleted = await requestJson(`${server.url}/api/v1/sessions/${sessionId}`, { method: 'DELETE' });
      expect(deleted.status).toBe(200);
      expect(deleted.body).toEqual({ ok: true, sessionId });

      const immediate = await requestJson(`${server.url}/api/v1/sessions/${sessionId}`);
      expect(isRecord(immediate.body) && immediate.body.status).toBe('killed');

      const events = await finished;
      expect(events.at(-1)?.type).toBe('done');
      await waitFor(async () => {
        const current = await requestJson(`${server.url}/api/v1/sessions/${sessionId}`);
        return isRecord(current.body) && current.body.exitCode !== undefined;
      }, 4_000);
    } finally {
      await server.close();
    }
  });

  it('keeps the session running when the SSE client disconnects', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const adapter = new ScriptedAdapter('cursor', async ({ onEvent, sessionId }) => {
      onEvent(createStreamEvent(sessionId, 'init', { text: 'started' }));
      await gate;
      onEvent(createStreamEvent(sessionId, 'chunk', { text: 'after-disconnect' }));
      onEvent(createStreamEvent(sessionId, 'done', { durationMs: 1 }));
      return { exitCode: 0, summary: 'after-disconnect' };
    });
    const server = await startTestServer({ runtime: runtimeFor({ cursor: adapter }) });
    try {
      const created = await postJson(`${server.url}/api/v1/sessions`, {
        provider: 'cursor',
        cwd: tmpdir(),
        prompt: 'stay up',
      });
      if (!isRecord(created.body)) throw new Error('expected session body');
      const sessionId = String(created.body.sessionId);
      const controller = new AbortController();
      const response = await fetch(`${server.url}/api/v1/sessions/${sessionId}/stream`, {
        signal: controller.signal,
      });
      const received: UnifiedStreamEvent[] = [];
      const finished = collectSse(response, (event) => received.push(event));
      await waitFor(() => received.some((event) => event.type === 'init'));
      controller.abort();
      await finished;
      release();
      await waitFor(async () => {
        const current = await requestJson(`${server.url}/api/v1/sessions/${sessionId}`);
        return isRecord(current.body) && current.body.status === 'completed';
      });
    } finally {
      release();
      await server.close();
    }
  });

  it('returns 404 for an unknown session', async () => {
    const server = await startTestServer({ runtime: runtimeFor({ cursor: scriptedEcho() }) });
    try {
      const missing = await requestJson(`${server.url}/api/v1/sessions/sess_missing`);
      const stream = await fetch(`${server.url}/api/v1/sessions/sess_missing/stream`);
      const deleted = await requestJson(`${server.url}/api/v1/sessions/sess_missing`, { method: 'DELETE' });
      expect(missing.status).toBe(404);
      expect(stream.status).toBe(404);
      expect(deleted.status).toBe(404);
    } finally {
      await server.close();
    }
  });
});

function scriptedEcho(): ScriptedAdapter {
  return new ScriptedAdapter('cursor', async ({ onEvent, sessionId }) => {
    onEvent(createStreamEvent(sessionId, 'init', { text: 'started' }));
    onEvent(createStreamEvent(sessionId, 'chunk', { text: 'hello ' }));
    onEvent(createStreamEvent(sessionId, 'chunk', { text: 'world' }));
    onEvent(createStreamEvent(sessionId, 'done', { durationMs: 5 }));
    return { exitCode: 0, summary: 'hello world' };
  });
}

class MissingAntigravity implements CLIAdapter {
  readonly provider = 'antigravity' as const;

  async isAvailable(): Promise<boolean> {
    return false;
  }

  async getBinaryPath(): Promise<string> {
    throw new BinaryNotFoundError(this.provider);
  }

  async execute(
    _options: PromptOptions,
    _onEvent: (event: UnifiedStreamEvent) => void,
  ): Promise<{ exitCode: number; summary: string }> {
    throw new Error('execute should not be called');
  }

  async kill(): Promise<boolean> {
    return false;
  }
}

function adapterWithBinary(provider: 'cursor', binaryPath: string): CLIAdapter {
  const binaries = new BinaryResolver({
    which: async () => null,
    isExecutable: async (filePath) => filePath === binaryPath,
    candidates: {
      [provider]: { commands: ['missing-binary'], paths: [binaryPath] },
    },
  });
  return createAdapter(provider, { binaries });
}

function eventTypes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((event) => (isRecord(event) && typeof event.type === 'string' ? [event.type] : []));
}

function parseAll(raw: string): UnifiedStreamEvent[] {
  return raw
    .split('\n\n')
    .filter((block) => block.trim().length > 0)
    .map((block) => {
      const dataLine = block.split('\n').find((line) => line.startsWith('data:'));
      if (!dataLine) throw new Error(`missing data in ${block}`);
      return JSON.parse(dataLine.slice('data:'.length).trim()) as UnifiedStreamEvent;
    });
}
