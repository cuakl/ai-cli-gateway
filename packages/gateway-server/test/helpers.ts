import type { UnifiedStreamEvent } from '@gateway/shared-types';
import type { FastifyInstance } from 'fastify';
import { buildServer, type BuildServerOptions } from '../src/app.js';

export interface TestServer {
  app: FastifyInstance;
  url: string;
  wsUrl: string;
  close: () => Promise<void>;
}

export async function startTestServer(options?: BuildServerOptions): Promise<TestServer> {
  const app = await buildServer(options);
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (!address || typeof address === 'string') {
    throw new Error('test server did not bind a TCP port');
  }
  return {
    app,
    url: `http://127.0.0.1:${address.port}`,
    wsUrl: `ws://127.0.0.1:${address.port}/ws`,
    close: () => app.close(),
  };
}

export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5_000,
): Promise<void> {
  const started = Date.now();
  while (!(await predicate())) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('condition was not met in time');
    }
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function requestJson(
  url: string,
  init?: RequestInit,
): Promise<{ status: number; body: unknown; headers: Headers }> {
  const response = await fetch(url, init);
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: text.length > 0 ? (JSON.parse(text) as unknown) : null,
  };
}

export function postJson(url: string, body: unknown): Promise<{ status: number; body: unknown; headers: Headers }> {
  return requestJson(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Read an SSE response, invoking `onEvent` as each event arrives. */
export async function collectSse(
  response: Response,
  onEvent?: (event: UnifiedStreamEvent) => void,
): Promise<UnifiedStreamEvent[]> {
  if (!response.body) throw new Error('expected an SSE body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events: UnifiedStreamEvent[] = [];
  let buffer = '';

  const consume = (): void => {
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';
    for (const block of blocks) {
      if (!block.trim()) continue;
      const event = parseSseBlock(block);
      events.push(event);
      onEvent?.(event);
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
    // The server closed the socket or the caller aborted the request.
  }
  return events;
}

function parseSseBlock(block: string): UnifiedStreamEvent {
  let eventName = 'message';
  const dataLines: string[] = [];
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('event:')) eventName = line.slice('event:'.length).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trim());
  }
  if (dataLines.length === 0) {
    throw new Error(`SSE block is missing data: ${block}`);
  }
  const data = JSON.parse(dataLines.join('\n')) as UnifiedStreamEvent;
  if (data.type !== eventName) {
    throw new Error(`SSE event "${eventName}" does not match payload type "${data.type}"`);
  }
  return data;
}
