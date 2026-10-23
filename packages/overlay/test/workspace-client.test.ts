import type { WorkspaceServerMessage } from '@aidev/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceClient, WorkspaceError, workspaceSocketUrl, type WorkspaceSocket } from '../src/ui/workspace-client.js';

class FakeSocket implements WorkspaceSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: Event) => void) | null = null;

  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    const event = new Event('close');
    if (code !== undefined) Object.defineProperty(event, 'code', { value: code });
    this.onclose?.(event);
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }

  receive(data: string): void {
    this.onmessage?.({ data });
  }
}

const summary = { files: [], insertions: 0, deletions: 0 };

function client(): WorkspaceClient {
  return new WorkspaceClient({
    gatewayUrl: 'http://127.0.0.1:4100',
    projectId: 'proj_1',
    browserToken: 'tok_1',
    WebSocket: FakeSocket,
  });
}

describe('WorkspaceClient', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    FakeSocket.instances = [];
  });

  it('builds the project socket url', () => {
    expect(workspaceSocketUrl('http://127.0.0.1:4100', 'proj_1', 'tok_1')).toBe(
      'ws://127.0.0.1:4100/api/v1/projects/proj_1/ws?token=tok_1',
    );
    expect(workspaceSocketUrl('https://example.com/ignored', 'proj_1', 'tok/1')).toBe(
      'wss://example.com/api/v1/projects/proj_1/ws?token=tok%2F1',
    );
  });

  it('resolves request() from the matching reply and ignores other frames', async () => {
    const connection = client();
    const socket = FakeSocket.instances[0];
    expect(socket).toBeTruthy();
    expect(connection.state).toBe('connecting');
    expect(socket?.url).toBe('ws://127.0.0.1:4100/api/v1/projects/proj_1/ws?token=tok_1');

    const pending = connection.request({ type: 'git.diff' });
    expect(socket?.sent).toHaveLength(0);
    socket?.open();
    expect(connection.state).toBe('open');
    expect(socket?.sent).toHaveLength(1);
    const sent = JSON.parse(socket?.sent[0] ?? '{}') as { type?: string; requestId?: string };
    expect(sent.type).toBe('git.diff');
    expect(sent.requestId).toEqual(expect.any(String));

    const seen: WorkspaceServerMessage[] = [];
    connection.on('git.changed', (message) => {
      seen.push(message);
    });
    connection.on('run.event', (message) => {
      seen.push(message);
    });

    socket?.receive('not-json');
    socket?.receive(JSON.stringify({ type: 'git.changed', summary: { files: 'nope' } }));
    socket?.receive(JSON.stringify({ type: 'git.diff.result', requestId: 'someone-else', summary }));
    socket?.receive(
      JSON.stringify({
        type: 'run.event',
        requestId: sent.requestId,
        runId: 'run_1',
        event: {
          id: 'evt_1',
          sessionId: 'sess_1',
          type: 'chunk',
          timestamp: 1,
          payload: { text: 'Hi', segment: 0 },
        },
      }),
    );
    socket?.receive(JSON.stringify({ type: 'git.changed', requestId: sent.requestId, summary }));

    let settled = false;
    void pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(seen.map((message) => message.type)).toEqual(['run.event', 'git.changed']);

    socket?.receive(JSON.stringify({ type: 'git.diff.result', requestId: sent.requestId, summary }));
    await expect(pending).resolves.toMatchObject({ type: 'git.diff.result', summary });
    connection.close();
  });

  it('rejects an error reply and keeps the server code', async () => {
    const connection = client();
    const socket = FakeSocket.instances[0];
    socket?.open();
    const errors: WorkspaceServerMessage[] = [];
    connection.on('error', (message) => {
      errors.push(message);
    });
    const pending = connection.request({
      type: 'run.start',
      provider: 'cursor',
      mode: 'agent',
      prompt: 'Hi',
      context: { recentErrors: [], recentConsoleLogs: [], failedNetworkRequests: [] },
      attachments: [],
    });
    const sent = JSON.parse(socket?.sent[0] ?? '{}') as { requestId?: string };
    socket?.receive(JSON.stringify({ type: 'error', code: 'internal', message: 'unrelated' }));
    socket?.receive(
      JSON.stringify({
        type: 'error',
        requestId: sent.requestId,
        code: 'conflicted',
        message: 'The working tree has conflicts',
      }),
    );
    await expect(pending).rejects.toBeInstanceOf(WorkspaceError);
    await expect(pending).rejects.toMatchObject({
      code: 'conflicted',
      message: 'The working tree has conflicts',
    });
    expect(errors).toHaveLength(2);
    connection.close();
  });

  it('reconnects with exponential backoff capped at 5s and stops after close', async () => {
    vi.useFakeTimers();
    const connection = client();
    const states: string[] = [];
    connection.onStateChange((state) => {
      states.push(state);
    });
    const sockets = () => FakeSocket.instances;

    expect(sockets()).toHaveLength(1);
    sockets()[0]?.close();
    expect(connection.state).toBe('connecting');
    await vi.advanceTimersByTimeAsync(249);
    expect(sockets()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets()).toHaveLength(2);

    sockets()[1]?.close();
    await vi.advanceTimersByTimeAsync(499);
    expect(sockets()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets()).toHaveLength(3);

    sockets()[2]?.open();
    expect(connection.state).toBe('open');
    expect(states).toContain('open');
    sockets()[2]?.close();
    expect(connection.state).toBe('connecting');
    await vi.advanceTimersByTimeAsync(250);
    expect(sockets()).toHaveLength(4);

    sockets()[3]?.close();
    await vi.advanceTimersByTimeAsync(500);
    sockets()[4]?.close();
    await vi.advanceTimersByTimeAsync(1000);
    sockets()[5]?.close();
    await vi.advanceTimersByTimeAsync(2000);
    sockets()[6]?.close();
    await vi.advanceTimersByTimeAsync(4000);
    expect(sockets()).toHaveLength(8);
    sockets()[7]?.close();
    await vi.advanceTimersByTimeAsync(4999);
    expect(sockets()).toHaveLength(8);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets()).toHaveLength(9);

    const open = sockets()[8];
    open?.open();
    const pending = connection.request({ type: 'git.status' });
    open?.close();
    await expect(pending).rejects.toMatchObject({ code: 'disconnected' });

    connection.close();
    expect(connection.state).toBe('closed');
    const count = sockets().length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(sockets()).toHaveLength(count);
  });

  it('times out a request after 30s', async () => {
    vi.useFakeTimers();
    const connection = client();
    FakeSocket.instances[0]?.open();
    const pending = connection.request({ type: 'git.diff' });
    await vi.advanceTimersByTimeAsync(29_999);
    let settled = false;
    void pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).rejects.toMatchObject({ code: 'timeout' });
    connection.close();
  });

  it('does not refresh credentials on a normal close', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const connection = client();
    FakeSocket.instances[0]?.open();
    FakeSocket.instances[0]?.close();
    await vi.advanceTimersByTimeAsync(250);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(FakeSocket.instances).toHaveLength(2);
    connection.close();
  });

  it('loads a fresh browser token after an auth failure and reconnects', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (input: string | URL) => {
      const href = input instanceof URL ? input.href : input;
      if (!href.endsWith('/@ai-devtools/config')) throw new Error(href);
      return new Response(
        JSON.stringify({
          gatewayUrl: 'http://127.0.0.1:4100',
          projectId: 'proj_next',
          browserToken: 'tok_next',
          projectName: 'demo',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const connection = client();
    FakeSocket.instances[0]?.close(1006);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const raw = fetchMock.mock.calls[0]?.[0];
    const href = raw instanceof URL ? raw.href : String(raw);
    const requested = new URL(href);
    expect(requested.origin).toBe(location.origin);
    expect(requested.pathname).toBe('/@ai-devtools/config');
    await vi.advanceTimersByTimeAsync(249);
    expect(FakeSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeSocket.instances).toHaveLength(2);
    expect(FakeSocket.instances[1]?.url).toBe(workspaceSocketUrl('http://127.0.0.1:4100', 'proj_next', 'tok_next'));

    FakeSocket.instances[1]?.open();
    FakeSocket.instances[1]?.close(4403);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(250);
    expect(FakeSocket.instances[2]?.url).toBe(workspaceSocketUrl('http://127.0.0.1:4100', 'proj_next', 'tok_next'));
    connection.close();
  });
});
