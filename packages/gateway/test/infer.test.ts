import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { CliAuthError, providerSetup, type CLIAdapter } from '@aidev/adapters';
import { createStreamEvent, type PromptOptions, type ProviderCapabilities } from '@aidev/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultConfig, writeConfig } from '../src/home.js';
import { isRecord, postJson, requestJson, startTestServer, waitFor, type TestServer } from './helpers.js';
import { runtimeFor, ScriptedAdapter } from './scripted-adapter.js';

const PRODUCT_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
  },
  required: ['name', 'tags'],
};

const servers: TestServer[] = [];
const dirs: string[] = [];

describe('POST /api/v1/infer', () => {
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('rejects a missing token with 401 and a browser token with 403', async () => {
    const server = await launch({ authenticateFetch: false });
    const unauth = await postJson(`${server.url}/api/v1/infer`, {
      messages: [{ role: 'user', content: 'Hi' }],
    });
    expect(unauth.status).toBe(401);
    expect(unauth.body).toEqual({ error: 'unauthorized' });

    const root = await tempDir('infer-browser-');
    const registered = await postJson(
      `${server.url}/api/v1/projects/register`,
      { root, origin: 'http://localhost:5173' },
      { headers: { authorization: `Bearer ${server.token}` } },
    );
    expect(isRecord(registered.body)).toBe(true);
    if (!isRecord(registered.body)) return;
    const browser = await postJson(
      `${server.url}/api/v1/infer`,
      { messages: [{ role: 'user', content: 'Hi' }] },
      { headers: { authorization: `Bearer ${String(registered.body.browserToken)}` } },
    );
    expect(browser.status).toBe(403);
    expect(browser.body).toEqual({ error: 'forbidden' });
  });

  it('accepts a token listed in config.inferenceTokens', async () => {
    const home = await tempDir('infer-token-home-');
    await writeConfig(home, { ...defaultConfig(), inferenceTokens: ['inf_test_token'] });
    const seen: PromptOptions[] = [];
    const server = await launch({
      home,
      authenticateFetch: false,
      adapter: echoAdapter('pong', seen),
    });
    const response = await postJson(
      `${server.url}/api/v1/infer`,
      { messages: [{ role: 'user', content: 'Reply with exactly: pong' }] },
      { headers: { authorization: 'Bearer inf_test_token' } },
    );
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ text: 'pong', provider: 'cursor' });
    expect(seen[0]?.mode).toBe('ask');
  });

  it('returns non-stream text, records an api thread, and removes the scratch dir', async () => {
    const seen: PromptOptions[] = [];
    const server = await launch({ adapter: echoAdapter('hello world', seen) });
    const response = await postJson(`${server.url}/api/v1/infer`, {
      messages: [{ role: 'user', content: 'Say hello' }],
    });
    expect(response.status).toBe(200);
    expect(isRecord(response.body)).toBe(true);
    if (!isRecord(response.body)) return;
    expect(response.body.text).toBe('hello world');
    expect(response.body.provider).toBe('cursor');
    expect(typeof response.body.id).toBe('string');
    expect(typeof response.body.threadId).toBe('string');
    expect(typeof response.body.durationMs).toBe('number');
    expect(seen[0]?.mode).toBe('ask');
    expect(seen[0]?.ephemeral).toBe(true);
    expect(seen[0]?.cwd).toBe(path.join(server.home, 'scratch', String(response.body.id)));
    expect(existsSync(path.join(server.home, 'scratch', String(response.body.id)))).toBe(false);

    const thread = await requestJson(`${server.url}/api/v1/threads/${String(response.body.threadId)}`);
    expect(thread.status).toBe(200);
    expect(isRecord(thread.body) && isRecord(thread.body.thread) && thread.body.thread).toMatchObject({
      source: 'api',
      keep: false,
      mode: 'ask',
      projectId: null,
    });
  });

  it('renders system messages and prior turns into systemPrompt and the prompt', async () => {
    const seen: PromptOptions[] = [];
    const server = await launch({ adapter: echoAdapter('blue', seen) });
    const response = await postJson(`${server.url}/api/v1/infer`, {
      system: 'Be brief',
      messages: [
        { role: 'system', content: 'Stay terse.' },
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello' },
        { role: 'user', content: 'Name a color' },
      ],
    });
    expect(response.status).toBe(200);
    expect(seen).toHaveLength(1);
    const options = seen[0];
    expect(options?.systemPrompt).toContain('Be brief');
    expect(options?.systemPrompt).toContain('Stay terse.');
    expect(options?.prompt).toContain('<conversation>');
    expect(options?.prompt).toContain('User: Hi');
    expect(options?.prompt).toContain('Assistant: Hello');
    expect(options?.prompt.endsWith('Name a color')).toBe(true);
  });

  it('streams delta frames then done, omitting notices and tool events', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const adapter = new ScriptedAdapter('cursor', async ({ onEvent, sessionId }) => {
      onEvent(createStreamEvent(sessionId, 'init', { text: 'started' }));
      onEvent(createStreamEvent(sessionId, 'chunk', { text: 'Already dirty.', segment: -1 }));
      onEvent(createStreamEvent(sessionId, 'chunk', { text: 'hel' }));
      await gate;
      onEvent(createStreamEvent(sessionId, 'tool_call', { toolName: 'Read', toolCallId: 'c1' }));
      onEvent(createStreamEvent(sessionId, 'chunk', { text: 'lo' }));
      onEvent(createStreamEvent(sessionId, 'done', { durationMs: 4 }));
      return { exitCode: 0, summary: 'hello' };
    });
    const server = await launch({ adapter });
    try {
      const response = await fetch(`${server.url}/api/v1/infer`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stream: true, messages: [{ role: 'user', content: 'Hi' }] }),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      const received: Array<{ event: string; data: unknown }> = [];
      const finished = collectNamedSseLive(response, (frame) => received.push(frame));
      await waitFor(() => received.some((frame) => frame.event === 'delta'));
      expect(received.map((frame) => frame.event)).toEqual(['delta']);
      expect(received[0]?.data).toEqual({ text: 'hel' });
      release();
      const frames = await finished;
      expect(frames.map((frame) => frame.event)).toEqual(['delta', 'delta', 'done']);
      expect(frames[1]?.data).toEqual({ text: 'lo' });
      expect(isRecord(frames[2]?.data) && frames[2].data).toMatchObject({ text: 'hello' });
      expect(frames.some((frame) => JSON.stringify(frame.data).includes('Already dirty'))).toBe(false);
      expect(frames.some((frame) => JSON.stringify(frame.data).includes('Read'))).toBe(false);
    } finally {
      release();
    }
  });

  it('returns object when jsonSchema matches, including fenced JSON', async () => {
    const seen: PromptOptions[] = [];
    const adapter = new ScriptedAdapter('cursor', async ({ options, onEvent, sessionId }) => {
      seen.push(options);
      onEvent(
        createStreamEvent(sessionId, 'chunk', {
          text: 'Here.\n```json\n{"name":"Lamp","tags":["desk","warm","led"]}\n```\n',
        }),
      );
      onEvent(createStreamEvent(sessionId, 'done', {}));
      return { exitCode: 0, summary: 'json' };
    });
    const server = await launch({ adapter });
    const response = await postJson(`${server.url}/api/v1/infer`, {
      messages: [{ role: 'user', content: 'Invent a product' }],
      jsonSchema: PRODUCT_SCHEMA,
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      object: { name: 'Lamp', tags: ['desk', 'warm', 'led'] },
    });
    expect(seen[0]?.systemPrompt).toContain('Reply with only a JSON value matching this JSON Schema:');
    expect(seen[0]?.jsonSchema).toBeUndefined();
    expect(seen).toHaveLength(1);
  });

  it('retries once with validation errors and then succeeds', async () => {
    const seen: PromptOptions[] = [];
    let calls = 0;
    const adapter = new ScriptedAdapter('cursor', async ({ options, onEvent, sessionId }) => {
      seen.push(options);
      calls += 1;
      const text =
        calls === 1 ? '{"name":1,"tags":["x"]}' : '{"name":"Lamp","tags":["desk","warm","led"]}';
      onEvent(createStreamEvent(sessionId, 'chunk', { text }));
      onEvent(createStreamEvent(sessionId, 'done', {}));
      return { exitCode: 0, summary: text };
    });
    const server = await launch({ adapter });
    const response = await postJson(`${server.url}/api/v1/infer`, {
      messages: [{ role: 'user', content: 'Invent a product' }],
      jsonSchema: PRODUCT_SCHEMA,
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ object: { name: 'Lamp', tags: ['desk', 'warm', 'led'] } });
    expect(seen).toHaveLength(2);
    expect(seen[1]?.prompt).toContain('The previous reply was not valid JSON for the schema');
    expect(seen[1]?.prompt).toContain('Invent a product');
  });

  it('returns 422 invalid_structured_output after a failed retry', async () => {
    const adapter = new ScriptedAdapter('cursor', async ({ onEvent, sessionId }) => {
      onEvent(createStreamEvent(sessionId, 'chunk', { text: '{"name":1}' }));
      onEvent(createStreamEvent(sessionId, 'done', {}));
      return { exitCode: 0, summary: 'bad' };
    });
    const server = await launch({ adapter });
    const response = await postJson(`${server.url}/api/v1/infer`, {
      messages: [{ role: 'user', content: 'Invent a product' }],
      jsonSchema: PRODUCT_SCHEMA,
    });
    expect(response.status).toBe(422);
    expect(isRecord(response.body)).toBe(true);
    if (!isRecord(response.body)) return;
    expect(response.body.error).toBe('invalid_structured_output');
    expect(response.body.raw).toBe('{"name":1}');
    expect(response.body.issues).toBeDefined();
  });

  it('passes jsonSchema to the adapter when capabilities.supportsJsonSchema is true', async () => {
    const seen: PromptOptions[] = [];
    const adapter = echoAdapter('{"name":"Lamp","tags":["a"]}', seen);
    const server = await startTestServer({
      authenticateFetch: true,
      runtime: {
        getAdapter: () => adapter,
        listProviders: async () => [{ provider: 'cursor', available: true, binaryPath: '/mock/bin/cursor' }],
        listCapabilities: async () => [jsonSchemaCapability()],
      },
    });
    servers.push(server);
    const response = await postJson(`${server.url}/api/v1/infer`, {
      messages: [{ role: 'user', content: 'Invent a product' }],
      jsonSchema: PRODUCT_SCHEMA,
    });
    expect(response.status).toBe(200);
    expect(seen[0]?.jsonSchema).toEqual(PRODUCT_SCHEMA);
  });

  it('maps cli_auth_required and respects maxConcurrentRuns with 429', async () => {
    const home = await tempDir('infer-busy-');
    await writeConfig(home, { ...defaultConfig(), maxConcurrentRuns: 1 });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holding = false;
    const adapter = new ScriptedAdapter('cursor', async (ctx) => {
      if (ctx.options.prompt === 'hold') {
        holding = true;
        await gate;
      }
      ctx.onEvent(createStreamEvent(ctx.sessionId, 'chunk', { text: 'ok' }));
      ctx.onEvent(createStreamEvent(ctx.sessionId, 'done', {}));
      return { exitCode: 0, summary: 'ok' };
    });
    const server = await launch({ home, adapter });
    try {
      const hanging = fetch(`${server.url}/api/v1/infer`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hold' }] }),
      });
      await waitFor(() => holding);
      const blocked = await postJson(`${server.url}/api/v1/infer`, {
        messages: [{ role: 'user', content: 'nope' }],
      });
      expect(blocked.status).toBe(429);
      expect(blocked.body).toMatchObject({ error: 'too_many_runs' });
      expect(blocked.headers.get('retry-after')).toBe('5');
      release();
      expect((await hanging).status).toBe(200);
    } finally {
      release();
    }

    const authServer = await startTestServer({
      runtime: runtimeFor({ claude: new UnauthenticatedClaude() }),
    });
    servers.push(authServer);
    const auth = await postJson(`${authServer.url}/api/v1/infer`, {
      provider: 'claude',
      messages: [{ role: 'user', content: 'Hi' }],
    });
    expect(auth.status).toBe(422);
    expect(auth.body).toMatchObject({ error: 'cli_auth_required', setup: providerSetup('claude') });
  });
});

async function launch(options: {
  adapter?: ScriptedAdapter;
  home?: string;
  authenticateFetch?: boolean;
}): Promise<TestServer> {
  const adapter = options.adapter ?? echoAdapter('ok');
  const server = await startTestServer({
    ...(options.home ? { home: options.home } : {}),
    authenticateFetch: options.authenticateFetch !== false,
    registerDefaultRoot: false,
    runtime: runtimeFor({ cursor: adapter }),
  });
  servers.push(server);
  return server;
}

function echoAdapter(text: string, seen: PromptOptions[] = []): ScriptedAdapter {
  return new ScriptedAdapter('cursor', async ({ options, onEvent, sessionId }) => {
    seen.push(options);
    onEvent(createStreamEvent(sessionId, 'init', { text: 'started' }));
    onEvent(createStreamEvent(sessionId, 'chunk', { text }));
    onEvent(createStreamEvent(sessionId, 'done', { durationMs: 3 }));
    return { exitCode: 0, summary: text };
  });
}

function jsonSchemaCapability(): ProviderCapabilities {
  return {
    provider: 'cursor',
    available: true,
    binaryPath: '/mock/bin/cursor',
    version: null,
    verified: true,
    modes: ['agent', 'ask', 'plan'],
    models: [],
    supportsResume: true,
    supportsImages: false,
    supportsJsonSchema: true,
    supportsSystemPrompt: true,
  };
}

class UnauthenticatedClaude implements CLIAdapter {
  readonly provider = 'claude' as const;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async getBinaryPath(): Promise<string> {
    return '/mock/bin/claude';
  }

  async execute(): Promise<{ exitCode: number; summary: string }> {
    const setup = providerSetup(this.provider);
    throw new CliAuthError(this.provider, 'Claude Code (`claude`) is not authenticated.\n1. sign in', setup);
  }

  async kill(): Promise<boolean> {
    return false;
  }
}

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

async function collectNamedSseLive(
  response: Response,
  onFrame?: (frame: { event: string; data: unknown }) => void,
): Promise<Array<{ event: string; data: unknown }>> {
  if (!response.body) throw new Error('expected an SSE body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const frames: Array<{ event: string; data: unknown }> = [];
  let buffer = '';
  const consume = (): void => {
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';
    for (const block of blocks) {
      const frame = parseNamedBlock(block);
      if (!frame) continue;
      frames.push(frame);
      onFrame?.(frame);
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      consume();
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      buffer += '\n\n';
      consume();
    }
  } catch {
    // Client abort or server close.
  }
  return frames;
}

function parseNamedBlock(block: string): { event: string; data: unknown } | undefined {
  if (!block.trim()) return undefined;
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trim());
  }
  if (dataLines.length === 0) return undefined;
  return { event, data: JSON.parse(dataLines.join('\n')) as unknown };
}
