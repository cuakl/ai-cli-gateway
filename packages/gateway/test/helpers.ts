import { mkdtemp, rm } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { UnifiedStreamEvent } from '@aidev/protocol';
import type { FastifyInstance } from 'fastify';
import { buildServer, type BuildServerOptions } from '../src/app.js';
import { readMachineToken } from '../src/home.js';

export interface TestServerOptions extends BuildServerOptions {
  /** When no `root` is passed, register the OS temp directory so existing cwd: tmpdir() prompts stay inside a project. */
  registerDefaultRoot?: boolean;
  /** Attach the machine token to global fetch for this server. Defaults to true. */
  authenticateFetch?: boolean;
}

export interface TestServer {
  app: FastifyInstance;
  url: string;
  wsUrl: string;
  token: string;
  home: string;
  close: () => Promise<void>;
}

export async function startTestServer(options: TestServerOptions = {}): Promise<TestServer> {
  const { registerDefaultRoot, authenticateFetch, ...serverOptions } = options;
  const ownedHome = serverOptions.home === undefined;
  const home = serverOptions.home ?? (await mkdtemp(path.join(tmpdir(), 'aidev-home-')));
  const registerDefault = registerDefaultRoot !== false && serverOptions.root === undefined;
  const root = serverOptions.root ?? (registerDefault ? realpathSync(tmpdir()) : undefined);
  const app = await buildServer({
    ...serverOptions,
    home,
    ...(root ? { root } : {}),
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (!address || typeof address === 'string') {
    throw new Error('test server did not bind a TCP port');
  }
  const token = await readMachineToken(home);
  const url = `http://127.0.0.1:${address.port}`;
  const restore = authenticateFetch === false ? () => undefined : installAuthFetch(url, token);
  return {
    app,
    url,
    wsUrl: `ws://127.0.0.1:${address.port}/ws?token=${encodeURIComponent(token)}`,
    token,
    home,
    close: async () => {
      restore();
      await app.close();
      if (ownedHome) await rm(home, { recursive: true, force: true });
    },
  };
}

function installAuthFetch(base: string, token: string): () => void {
  const original = globalThis.fetch;
  const wrapped: typeof fetch = (input, init) => {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    if (!url.startsWith(base)) return original(input, init);
    const headers = new Headers(init?.headers);
    if (!headers.has('authorization')) headers.set('authorization', `Bearer ${token}`);
    return original(input, { ...init, headers });
  };
  globalThis.fetch = wrapped;
  return () => {
    if (globalThis.fetch === wrapped) globalThis.fetch = original;
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

export function postJson(url: string, body: unknown, init?: RequestInit): Promise<{ status: number; body: unknown; headers: Headers }> {
  const headers = new Headers(init?.headers);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  return requestJson(url, {
    ...init,
    method: 'POST',
    headers,
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
