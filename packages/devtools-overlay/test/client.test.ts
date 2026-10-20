import { GatewayClientMessageSchema, type UnifiedStreamEvent } from '@gateway/shared-types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GatewayClient,
  buildPromptMessage,
  composePrompt,
  consumeSseBuffer,
  gatewayWebSocketUrl,
} from '../src/ui/client.js';

class FakeSocket {
  static latest: FakeSocket | null = null;
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: Event) => void) | null = null;
  sent: string[] = [];

  constructor(public url: string) {
    FakeSocket.latest = this;
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.(new Event('open'));
    });
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    queueMicrotask(() => {
      this.onclose?.(new Event('close'));
    });
  }
}

function streamEvent(type: UnifiedStreamEvent['type'], text?: string): UnifiedStreamEvent {
  return {
    id: `evt_${type}`,
    sessionId: 'sess_1',
    type,
    timestamp: 1,
    payload: text ? { text } : {},
  };
}

describe('gateway client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeSocket.latest = null;
  });

  it('builds the websocket url and a prompt that carries context without the screenshot bytes', () => {
    expect(gatewayWebSocketUrl('http://127.0.0.1:4100')).toBe('ws://127.0.0.1:4100/ws');
    expect(gatewayWebSocketUrl('https://example.com/ignored')).toBe('wss://example.com/ws');

    const context = {
      selectedElement: {
        tagName: 'BUTTON',
        id: 'hero',
        className: 'btn',
        outerHTML: '<button id="hero"></button>',
        computedStyles: { display: 'inline-flex' },
      },
      screenshotBase64: 'data:image/png;base64,AAAA',
      recentErrors: [],
      recentConsoleLogs: [],
      failedNetworkRequests: [],
    };
    const prompt = composePrompt('Make it emerald', context);
    expect(prompt).toContain('<frontend_context>');
    expect(prompt).toContain('"screenshotIncluded": true');
    expect(prompt).not.toContain('AAAA');

    const message = buildPromptMessage({
      provider: 'antigravity',
      cwd: '/repo',
      prompt: 'Make it emerald',
      context,
    });
    expect(GatewayClientMessageSchema.parse(message)).toMatchObject({
      type: 'prompt',
      provider: 'antigravity',
      yolo: true,
      cwd: '/repo',
    });
  });

  it('reports health from GET /health', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      new Response(JSON.stringify({ status: 'ok' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new GatewayClient({ gatewayUrl: 'http://127.0.0.1:4100' });
    await expect(client.checkHealth()).resolves.toBe(true);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/health');

    fetchMock.mockResolvedValue(new Response('no', { status: 500 }));
    await expect(client.checkHealth()).resolves.toBe(false);
  });

  it('streams websocket chunks into the prompt handler', async () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    const client = new GatewayClient({ gatewayUrl: 'http://127.0.0.1:4100', cwd: '/repo' });
    const chunks: string[] = [];
    const done = client.streamPrompt({
      provider: 'cursor',
      prompt: 'Make it emerald',
      onChunk(text) {
        chunks.push(text);
      },
    });

    await vi.waitFor(() => expect(FakeSocket.latest?.sent).toHaveLength(1));
    const socket = FakeSocket.latest;
    expect(socket?.url).toBe('ws://127.0.0.1:4100/ws');
    const sent = GatewayClientMessageSchema.parse(JSON.parse(socket?.sent[0] ?? '{}'));
    expect(sent).toMatchObject({ type: 'prompt', provider: 'cursor', cwd: '/repo' });

    socket?.onmessage?.({ data: JSON.stringify({ type: 'ready', sessionId: 'sess_1' }) });
    socket?.onmessage?.({
      data: JSON.stringify({ type: 'event', event: streamEvent('chunk', 'Hello') }),
    });
    socket?.onmessage?.({
      data: JSON.stringify({ type: 'event', event: streamEvent('chunk', ' world') }),
    });
    socket?.onmessage?.({
      data: JSON.stringify({ type: 'event', event: streamEvent('done') }),
    });

    await done;
    expect(chunks).toEqual(['Hello', ' world']);
  });

  it('explains when the gateway cannot be reached', async () => {
    class DeadSocket {
      readyState = 0;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onclose: ((event: Event) => void) | null = null;
      constructor(public url: string) {
        queueMicrotask(() => {
          this.onerror?.(new Event('error'));
          this.onclose?.(new Event('close'));
        });
      }
      send(): void {}
      close(): void {
        this.readyState = 3;
      }
    }
    vi.stubGlobal('WebSocket', DeadSocket);
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));
    const client = new GatewayClient({ gatewayUrl: 'http://127.0.0.1:4100' });
    await expect(client.streamPrompt({ provider: 'cursor', prompt: 'Hi' })).rejects.toThrow(
      'Could not reach the gateway at http://127.0.0.1:4100',
    );
  });

  it('reads SSE chunk frames', () => {
    const chunks: string[] = [];
    let done = false;
    const event = streamEvent('chunk', 'Hi');
    const rest = consumeSseBuffer(`event: chunk\ndata: ${JSON.stringify(event)}\n\npartial`, {
      provider: 'claude',
      prompt: 'Hi',
      onChunk(text) {
        chunks.push(text);
      },
      onDone() {
        done = true;
      },
    });
    expect(chunks).toEqual(['Hi']);
    expect(done).toBe(false);
    expect(rest).toBe('partial');

    consumeSseBuffer(`event: done\ndata: ${JSON.stringify(streamEvent('done'))}\n\n`, {
      provider: 'claude',
      prompt: 'Hi',
      onDone() {
        done = true;
      },
    });
    expect(done).toBe(true);
  });
});
