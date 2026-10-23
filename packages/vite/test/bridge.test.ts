import { createStreamEvent, type CLIAdapter, type PromptOptions, type ProviderType } from '@aidev/adapters';
import type { ExecuteResult } from '@aidev/adapters';
import { describe, expect, it, vi } from 'vitest';
import { createPromptRunner, type DevtoolsPromptInput } from '../src/bridge.js';

const input: DevtoolsPromptInput = {
  provider: 'claude',
  prompt: 'Make the button green',
  cwd: '/proj',
  files: ['src/App.tsx'],
  yolo: true,
  context: {
    recentErrors: [],
    recentConsoleLogs: [],
    failedNetworkRequests: [],
    screenshotBase64: 'a'.repeat(80),
    selectedElement: {
      tagName: 'BUTTON',
      id: 'hero-btn',
      className: '',
      outerHTML: '<button id="hero-btn"></button>',
      computedStyles: {},
    },
  },
};

describe('createPromptRunner', () => {
  it('forwards the prompt, files, and context to the gateway and streams events back', async () => {
    let posted: Record<string, unknown> | undefined;
    let deleted = false;
    const chunk = createStreamEvent('sess_test', 'chunk', { text: 'Painting it green' });
    const done = createStreamEvent('sess_test', 'done', {});
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const pathname = new URL(typeof url === 'string' ? url : url instanceof URL ? url : url.url).pathname;
      if (pathname === '/health') return Response.json({ status: 'ok' });
      if (pathname === '/api/v1/sessions' && init?.method === 'POST') {
        posted = JSON.parse(String(init.body)) as Record<string, unknown>;
        return Response.json(
          { sessionId: 'sess_test', streamUrl: '/api/v1/sessions/sess_test/stream' },
          { status: 201 },
        );
      }
      if (pathname === '/api/v1/sessions/sess_test/stream') {
        const body = `event: chunk\ndata: ${JSON.stringify(chunk)}\n\nevent: done\ndata: ${JSON.stringify(done)}\n\n`;
        return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }
      if (pathname === '/api/v1/sessions/sess_test' && init?.method === 'DELETE') {
        deleted = true;
        return Response.json({ ok: true });
      }
      return new Response('missing', { status: 404 });
    });

    const events: string[] = [];
    const runner = createPromptRunner({ gatewayUrl: 'http://127.0.0.1:4100', fetchImpl });
    const session = await runner.start(input, (event) => events.push(event.type));
    expect(session.sessionId).toBe('sess_test');
    expect(posted).toMatchObject({
      provider: 'claude',
      cwd: '/proj',
      files: ['src/App.tsx'],
      yolo: true,
    });
    expect(String(posted?.prompt)).toContain('Make the button green');
    expect(String(posted?.prompt)).toContain('"id": "hero-btn"');
    expect(String(posted?.prompt)).toContain('"screenshotIncluded": true');
    expect(String(posted?.prompt)).not.toContain('a'.repeat(80));
    await vi.waitFor(() => expect(events).toEqual(['chunk', 'done']));
    await session.cancel();
    expect(deleted).toBe(true);
  });

  it('runs through @aidev/adapters when the gateway is unreachable', async () => {
    const seen: string[] = [];
    let killed = false;
    const fetchImpl = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED');
    });
    const runner = createPromptRunner({
      gatewayUrl: 'http://127.0.0.1:4100',
      fetchImpl,
      createAdapter: (provider) => fakeAdapter(provider, seen, () => {
        killed = true;
      }),
    });
    const events: string[] = [];
    const session = await runner.start(
      { provider: 'cursor', prompt: 'Fix the header', cwd: '/proj', files: ['src/Header.tsx'] },
      (event) => events.push(`${event.type}:${event.payload.text ?? ''}`),
    );
    expect(session.sessionId.startsWith('sess_')).toBe(true);
    expect(events[0]).toBe('chunk:edited');
    expect(events.at(-1)).toBe('done:');
    expect(seen).toEqual(['cursor:/proj:src/Header.tsx']);
    await session.cancel();
    expect(killed).toBe(true);
  });

  it('emits an error event when the gateway rejects the prompt', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const pathname = new URL(typeof url === 'string' ? url : url instanceof URL ? url : url.url).pathname;
      if (pathname === '/health') return Response.json({ status: 'ok' });
      if (init?.method === 'POST') {
        return Response.json({ message: 'Provider claude is not available' }, { status: 422 });
      }
      return new Response('missing', { status: 404 });
    });
    const runner = createPromptRunner({ fetchImpl });
    const events: Array<{ type: string; error?: string }> = [];
    await runner.start(input, (event) => events.push({ type: event.type, error: event.payload.error }));
    expect(events).toEqual([
      { type: 'error', error: 'Provider claude is not available' },
      { type: 'done', error: undefined },
    ]);
  });
});

function fakeAdapter(
  provider: ProviderType,
  seen: string[],
  onKill: () => void,
): CLIAdapter {
  return {
    provider,
    async isAvailable() {
      return true;
    },
    async getBinaryPath() {
      return '/usr/bin/agent';
    },
    async execute(options: PromptOptions, onEvent): Promise<ExecuteResult> {
      seen.push(`${provider}:${options.cwd}:${options.files?.join(',') ?? ''}`);
      const sessionId = options.sessionId ?? 'sess_local';
      onEvent(createStreamEvent(sessionId, 'chunk', { text: 'edited' }));
      onEvent(createStreamEvent(sessionId, 'done', {}));
      return { exitCode: 0, summary: 'edited' };
    },
    async kill() {
      onKill();
      return true;
    },
  };
}
