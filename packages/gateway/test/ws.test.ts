import { tmpdir } from 'node:os';
import { createStreamEvent, GatewayServerMessageSchema, type GatewayServerMessage } from '@aidev/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket, type RawData } from 'ws';
import { startTestServer, type TestServer } from './helpers.js';
import { runtimeFor, ScriptedAdapter } from './scripted-adapter.js';

describe('WebSocket /ws', () => {
  const adapter = new ScriptedAdapter('cursor', async (ctx) => {
    ctx.onEvent(createStreamEvent(ctx.sessionId, 'init', { text: 'started' }));
    if (ctx.options.prompt === 'hang') {
      await ctx.waitUntilKilled();
      ctx.onEvent(createStreamEvent(ctx.sessionId, 'done', {}));
      return { exitCode: 1, summary: '' };
    }
    ctx.onEvent(createStreamEvent(ctx.sessionId, 'chunk', { text: 'hello' }));
    ctx.onEvent(createStreamEvent(ctx.sessionId, 'done', { durationMs: 4 }));
    return { exitCode: 0, summary: 'hello' };
  });

  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer({ runtime: runtimeFor({ cursor: adapter }) });
  });

  afterAll(async () => {
    await server.close();
  });

  it('streams ready and unified events for a prompt', async () => {
    const socket = await openSocket(server.wsUrl);
    const messages = collect(socket);
    try {
      socket.send(
        JSON.stringify({
          type: 'prompt',
          provider: 'cursor',
          cwd: tmpdir(),
          prompt: 'hello',
        }),
      );
      await messages.waitFor((items) => items.some((item) => item.type === 'event' && item.event.type === 'done'));
      expect(messages.items[0]).toMatchObject({ type: 'ready', sessionId: expect.stringMatching(/^sess_/) });
      const events = messages.items.flatMap((item) => (item.type === 'event' ? [item.event] : []));
      expect(events.map((event) => event.type)).toEqual(['init', 'chunk', 'files_changed', 'done']);
      expect(events[1]?.payload.text).toBe('hello');
      for (const item of messages.items) {
        expect(GatewayServerMessageSchema.parse(item)).toEqual(item);
      }
    } finally {
      await closeSocket(socket);
    }
  });

  it('kills the session when the client sends cancel', async () => {
    const socket = await openSocket(server.wsUrl);
    const messages = collect(socket);
    try {
      socket.send(
        JSON.stringify({
          type: 'prompt',
          provider: 'cursor',
          cwd: tmpdir(),
          prompt: 'hang',
        }),
      );
      await messages.waitFor((items) => items.some((item) => item.type === 'event' && item.event.type === 'init'));
      const ready = messages.items.find((item) => item.type === 'ready');
      if (!ready || ready.type !== 'ready') throw new Error('expected a ready message');
      socket.send(JSON.stringify({ type: 'cancel', sessionId: ready.sessionId }));
      await messages.waitFor((items) => items.some((item) => item.type === 'event' && item.event.type === 'done'));
      expect(adapter.kills).toContain(ready.sessionId);
    } finally {
      await closeSocket(socket);
    }
  });

  it('reports invalid client messages without closing the socket', async () => {
    const socket = await openSocket(server.wsUrl);
    const messages = collect(socket);
    try {
      socket.send('not-json');
      await messages.waitFor((items) => items.some((item) => item.type === 'error'));
      expect(messages.items[0]).toMatchObject({ type: 'error', message: 'Invalid JSON message' });
      expect(socket.readyState).toBe(WebSocket.OPEN);
    } finally {
      await closeSocket(socket);
    }
  });
});

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
  items: GatewayServerMessage[];
  waitFor: (predicate: (items: GatewayServerMessage[]) => boolean, timeoutMs?: number) => Promise<void>;
} {
  const items: GatewayServerMessage[] = [];
  socket.on('message', (data: RawData) => {
    items.push(GatewayServerMessageSchema.parse(JSON.parse(data.toString())));
  });
  return {
    items,
    waitFor(predicate, timeoutMs = 3_000) {
      if (predicate(items)) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`timed out waiting for websocket messages: ${JSON.stringify(items)}`));
        }, timeoutMs);
        const onMessage = (): void => {
          if (!predicate(items)) return;
          clearTimeout(timer);
          socket.off('message', onMessage);
          resolve();
        };
        socket.on('message', onMessage);
      });
    },
  };
}
