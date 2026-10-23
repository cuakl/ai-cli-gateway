import { existsSync } from 'node:fs';
import path from 'node:path';
import { createStreamEvent, type PromptOptions } from '@aidev/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { parseOpenAiModel } from '../src/routes/openai.js';
import { isRecord, postJson, requestJson, solidPng, startTestServer, waitFor, type TestServer } from './helpers.js';
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

describe('OpenAI-compatible /v1', () => {
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it('parses model ids', () => {
    expect(parseOpenAiModel(undefined)).toEqual({});
    expect(parseOpenAiModel('default')).toEqual({});
    expect(parseOpenAiModel('cursor')).toEqual({ provider: 'cursor' });
    expect(parseOpenAiModel('cursor/gpt-5')).toEqual({ provider: 'cursor', model: 'gpt-5' });
    expect(parseOpenAiModel('claude/sonnet')).toEqual({ provider: 'claude', model: 'sonnet' });
    expect(() => parseOpenAiModel('gpt-4')).toThrow(/Unknown model/);
  });

  it('rejects a missing token with the OpenAI error envelope', async () => {
    const server = await launch({ authenticateFetch: false });
    const unauth = await postJson(`${server.url}/v1/chat/completions`, {
      messages: [{ role: 'user', content: 'Hi' }],
    });
    expect(unauth.status).toBe(401);
    expect(unauth.body).toEqual({
      error: {
        message: 'Invalid authentication. Provide Authorization: Bearer <token>.',
        type: 'invalid_request_error',
        code: 'invalid_api_key',
      },
    });
  });

  it('rejects tools and functions with invalid_request_error', async () => {
    const server = await launch();
    const tools = await postJson(`${server.url}/v1/chat/completions`, {
      messages: [{ role: 'user', content: 'Hi' }],
      tools: [{ type: 'function', function: { name: 'lookup' } }],
    });
    expect(tools.status).toBe(400);
    expect(tools.body).toMatchObject({
      error: { type: 'invalid_request_error' },
    });
    const functions = await postJson(`${server.url}/v1/chat/completions`, {
      messages: [{ role: 'user', content: 'Hi' }],
      functions: [{ name: 'lookup' }],
    });
    expect(functions.status).toBe(400);
    expect(isRecord(functions.body) && isRecord(functions.body.error) && functions.body.error.type).toBe(
      'invalid_request_error',
    );
  });

  it('returns a chat.completion with zeroed usage and records source openai', async () => {
    const seen: PromptOptions[] = [];
    const server = await launch({ adapter: echoAdapter('hello world', seen) });
    const response = await postJson(`${server.url}/v1/chat/completions`, {
      model: 'cursor',
      messages: [{ role: 'user', content: 'Say hello' }],
    });
    expect(response.status).toBe(200);
    expect(isRecord(response.body)).toBe(true);
    if (!isRecord(response.body)) return;
    expect(response.body.object).toBe('chat.completion');
    expect(response.body.model).toBe('cursor');
    expect(response.body.usage).toEqual({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
    const choices = response.body.choices;
    expect(Array.isArray(choices)).toBe(true);
    expect(choices).toMatchObject([{ index: 0, message: { role: 'assistant', content: 'hello world' }, finish_reason: 'stop' }]);
    expect(seen[0]?.mode).toBe('ask');
    expect(seen[0]?.model).toBeUndefined();

    const id = String(response.body.id);
    expect(id.startsWith('chatcmpl-run_')).toBe(true);
    const runId = id.slice('chatcmpl-'.length);
    const threads = await requestJson(`${server.url}/api/v1/threads?source=openai`);
    expect(isRecord(threads.body) && Array.isArray(threads.body.threads)).toBe(true);
    if (!isRecord(threads.body) || !Array.isArray(threads.body.threads)) return;
    const thread = threads.body.threads.find((item) => isRecord(item) && item.source === 'openai');
    expect(thread).toMatchObject({ source: 'openai', mode: 'ask', projectId: null });
    expect(existsSync(path.join(server.home, 'scratch', runId))).toBe(false);
  });

  it('lists provider and provider/model ids', async () => {
    const server = await launch();
    const listed = await requestJson(`${server.url}/v1/models`);
    expect(listed.status).toBe(200);
    expect(isRecord(listed.body) && listed.body.object).toBe('list');
    if (!isRecord(listed.body) || !Array.isArray(listed.body.data)) return;
    const ids = listed.body.data.map((item) => (isRecord(item) ? item.id : null));
    expect(ids).toContain('cursor');
    expect(ids).toContain('claude');
    expect(ids).toContain('claude/sonnet');
    expect(listed.body.data[0]).toMatchObject({ object: 'model', owned_by: expect.any(String) });
  });

  it('streams chat.completion.chunk frames then [DONE]', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const adapter = new ScriptedAdapter('cursor', async ({ onEvent, sessionId }) => {
      onEvent(createStreamEvent(sessionId, 'chunk', { text: 'Already dirty.', segment: -1 }));
      onEvent(createStreamEvent(sessionId, 'chunk', { text: 'hel' }));
      await gate;
      onEvent(createStreamEvent(sessionId, 'chunk', { text: 'lo' }));
      onEvent(createStreamEvent(sessionId, 'done', { durationMs: 4 }));
      return { exitCode: 0, summary: 'hello' };
    });
    const server = await launch({ adapter });
    try {
      const response = await fetch(`${server.url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          stream: true,
          model: 'cursor/gpt-5',
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      const received: unknown[] = [];
      const finished = collectOpenAiSse(response, (payload) => received.push(payload));
      await waitFor(() => received.length >= 1);
      expect(isRecord(received[0]) && received[0].object).toBe('chat.completion.chunk');
      expect(isRecord(received[0]) && received[0].model).toBe('cursor/gpt-5');
      const firstChoices = isRecord(received[0]) && Array.isArray(received[0].choices) ? received[0].choices : [];
      expect(firstChoices[0]).toMatchObject({
        index: 0,
        delta: { role: 'assistant', content: 'hel' },
        finish_reason: null,
      });
      release();
      const frames = await finished;
      expect(frames.at(-1)).toBe('[DONE]');
      const chunks = frames.slice(0, -1).filter(isRecord);
      expect(chunks.map((frame) => frame.object)).toEqual([
        'chat.completion.chunk',
        'chat.completion.chunk',
        'chat.completion.chunk',
      ]);
      expect(chunks[1]).toMatchObject({
        choices: [{ delta: { content: 'lo' }, finish_reason: null }],
      });
      expect(chunks[2]).toMatchObject({
        choices: [{ delta: {}, finish_reason: 'stop' }],
      });
      expect(JSON.stringify(frames).includes('Already dirty')).toBe(false);
    } finally {
      release();
    }
  });

  it('maps json_schema response_format onto the structured pipeline', async () => {
    const seen: PromptOptions[] = [];
    const adapter = echoAdapter('{"name":"Lamp","tags":["desk"]}', seen);
    const server = await launch({ adapter });
    const response = await postJson(`${server.url}/v1/chat/completions`, {
      model: 'cursor',
      messages: [{ role: 'user', content: 'Invent a product' }],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'product', schema: PRODUCT_SCHEMA },
      },
    });
    expect(response.status).toBe(200);
    expect(isRecord(response.body)).toBe(true);
    if (!isRecord(response.body) || !Array.isArray(response.body.choices)) return;
    const message = response.body.choices[0];
    expect(isRecord(message) && isRecord(message.message) && message.message.content).toBe(
      '{"name":"Lamp","tags":["desk"]}',
    );
    expect(seen[0]?.systemPrompt).toContain('Reply with only a JSON value matching this JSON Schema:');
  });

  it('maps json_object onto a generic object schema', async () => {
    const seen: PromptOptions[] = [];
    const adapter = echoAdapter('{"ok":true}', seen);
    const server = await launch({ adapter });
    const response = await postJson(`${server.url}/v1/chat/completions`, {
      messages: [{ role: 'user', content: 'JSON please' }],
      response_format: { type: 'json_object' },
    });
    expect(response.status).toBe(200);
    expect(seen[0]?.systemPrompt).toContain('"type":"object"');
  });

  it('writes image_url data URLs into the scratch workspace', async () => {
    const seen: PromptOptions[] = [];
    const png = solidPng(255, 0, 0);
    const adapter = new ScriptedAdapter('cursor', async ({ options, onEvent, sessionId }) => {
      seen.push(options);
      onEvent(createStreamEvent(sessionId, 'chunk', { text: 'red' }));
      onEvent(createStreamEvent(sessionId, 'done', {}));
      return { exitCode: 0, summary: 'red' };
    });
    const server = await launch({ adapter });
    const response = await postJson(`${server.url}/v1/chat/completions`, {
      model: 'cursor',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is the dominant color of the attached image? One word.' },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${png.toString('base64')}` } },
          ],
        },
      ],
    });
    expect(response.status).toBe(200);
    expect(seen[0]?.prompt).toContain('Attached images (read them before answering):');
    expect(seen[0]?.prompt).toContain(`${path.sep}attachments${path.sep}0.png`);
    expect(seen[0]?.cwd).toBeTruthy();
  });
});

async function launch(options: {
  adapter?: ScriptedAdapter;
  home?: string;
  authenticateFetch?: boolean;
} = {}): Promise<TestServer> {
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

async function collectOpenAiSse(
  response: Response,
  onPayload?: (payload: unknown) => void,
): Promise<unknown[]> {
  if (!response.body) throw new Error('expected an SSE body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const frames: unknown[] = [];
  let buffer = '';
  const consume = (): void => {
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';
    for (const block of blocks) {
      const payload = parseOpenAiBlock(block);
      if (payload === undefined) continue;
      frames.push(payload);
      onPayload?.(payload);
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

function parseOpenAiBlock(block: string): unknown {
  const dataLines: string[] = [];
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trim());
  }
  if (dataLines.length === 0) return undefined;
  const data = dataLines.join('\n');
  if (data === '[DONE]') return '[DONE]';
  return JSON.parse(data) as unknown;
}
