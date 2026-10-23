import { afterEach, describe, expect, it, vi } from 'vitest';
import { AidevClientError, createClient, isAidevClientError } from '../src/index.js';

const calls: Array<{ url: string; init: RequestInit | undefined }> = [];

afterEach(() => {
  calls.length = 0;
  vi.unstubAllGlobals();
});

describe('createClient', () => {
  it('generate posts /api/v1/infer and returns the body', async () => {
    const ai = createClient({
      baseUrl: 'http://gateway.test',
      token: 'tok',
      fetch: mockFetch(async () =>
        jsonResponse({
          id: 'run_1',
          provider: 'cursor',
          model: 'gpt-5',
          text: 'pong',
          durationMs: 12,
          threadId: 'thr_1',
        }),
      ),
    });
    const result = await ai.generate({ prompt: 'Reply with exactly: pong', provider: 'cursor', model: 'gpt-5' });
    expect(result.text).toBe('pong');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://gateway.test/api/v1/infer');
    const init = calls[0]?.init;
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer tok');
    expect(JSON.parse(String(init?.body))).toEqual({
      messages: [{ role: 'user', content: 'Reply with exactly: pong' }],
      provider: 'cursor',
      model: 'gpt-5',
    });
  });

  it('stream yields delta texts from named SSE', async () => {
    const body = [
      'event: delta',
      'data: {"text":"hel"}',
      '',
      'event: delta',
      'data: {"text":"lo"}',
      '',
      'event: done',
      'data: {"id":"run_1","text":"hello","durationMs":3}',
      '',
      '',
    ].join('\n');
    const ai = createClient({
      token: 'tok',
      fetch: mockFetch(async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })),
    });
    const chunks: string[] = [];
    for await (const chunk of ai.stream({ prompt: 'Hi' })) chunks.push(chunk);
    expect(chunks).toEqual(['hel', 'lo']);
    expect(JSON.parse(String(calls[0]?.init?.body)).stream).toBe(true);
  });

  it('generateObject sends jsonSchema and returns the validated object', async () => {
    const schema = {
      type: 'object',
      properties: { name: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } },
      required: ['name', 'tags'],
    };
    const ai = createClient({
      token: 'tok',
      fetch: mockFetch(async () =>
        jsonResponse({
          id: 'run_1',
          provider: 'cursor',
          model: '',
          text: '{"name":"Lamp","tags":["desk"]}',
          durationMs: 1,
          threadId: 'thr_1',
          object: { name: 'Lamp', tags: ['desk'] },
        }),
      ),
    });
    const product = await ai.generateObject({ prompt: 'Invent a product', schema });
    expect(product).toEqual({ name: 'Lamp', tags: ['desk'] });
    expect(JSON.parse(String(calls[0]?.init?.body)).jsonSchema).toEqual(schema);
  });

  it('maps HTTP errors to AidevClientError with code', async () => {
    const ai = createClient({
      token: 'tok',
      fetch: mockFetch(async () =>
        jsonResponse({ error: 'invalid_structured_output', raw: '{', issues: [] }, 422),
      ),
    });
    try {
      await ai.generateObject({ prompt: 'x', schema: { type: 'object' } });
      expect.fail('expected throw');
    } catch (error) {
      expect(isAidevClientError(error)).toBe(true);
      if (!isAidevClientError(error)) return;
      expect(error).toBeInstanceOf(AidevClientError);
      expect(error.code).toBe('invalid_structured_output');
      expect(error.status).toBe(422);
    }
  });

  it('rejects a Zod schema when zod-to-json-schema is not installed', async () => {
    const ai = createClient({
      token: 'tok',
      fetch: mockFetch(async () => jsonResponse({})),
    });
    const zodLike = { safeParse: () => ({ success: true, data: {} }), _def: { typeName: 'ZodObject' } };
    await expect(ai.generateObject({ prompt: 'x', schema: zodLike })).rejects.toMatchObject({
      code: 'invalid_schema',
    });
    expect(calls).toHaveLength(0);
  });

  it('throws when prompt and messages are both missing', async () => {
    const ai = createClient({ token: 'tok', fetch: mockFetch(async () => jsonResponse({})) });
    await expect(ai.generate({})).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('turns a stream error frame into AidevClientError', async () => {
    const body = 'event: error\ndata: {"error":"cli_auth_required","message":"sign in"}\n\n';
    const ai = createClient({
      token: 'tok',
      fetch: mockFetch(async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })),
    });
    await expect(collect(ai.stream({ prompt: 'Hi' }))).rejects.toMatchObject({
      code: 'cli_auth_required',
    });
  });
});

function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response>): typeof fetch {
  const impl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    calls.push({ url, init });
    return handler(url, init);
  };
  return impl;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function collect(iter: AsyncIterable<string>): Promise<string[]> {
  const chunks: string[] = [];
  for await (const chunk of iter) chunks.push(chunk);
  return chunks;
}
