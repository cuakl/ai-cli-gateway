import { FrontendContextPayloadSchema } from '@aidev/protocol';
import { toPng } from 'html-to-image';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  gatherContext,
  installContextCollectors,
  uninstallContextCollectors,
} from '../src/context/index.js';
import { getFailedNetworkRequests } from '../src/context/network.js';
import { locateElement } from '../src/inspector/locator.js';

vi.mock('html-to-image', () => ({
  toPng: vi.fn(),
}));

const originalConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error,
};

describe('gatherContext', () => {
  afterEach(() => {
    uninstallContextCollectors();
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    vi.unstubAllGlobals();
    vi.mocked(toPng).mockReset();
  });

  it('assembles a schema-valid payload from the selected element, logs, and errors', async () => {
    console.error = (() => undefined) as typeof console.error;
    installContextCollectors();
    console.error('paint failed');
    window.onerror?.('explode', 'main.tsx', 12, 3, new Error('explode'));
    vi.mocked(toPng).mockResolvedValue('data:image/png;base64,abc');

    const button = document.createElement('button');
    button.id = 'hero';
    button.className = 'btn';
    button.textContent = 'Go';
    const selected = locateElement(button);
    const payload = await gatherContext(selected, button);

    expect(FrontendContextPayloadSchema.parse(payload)).toEqual(payload);
    expect(payload.screenshotBase64).toBe('data:image/png;base64,abc');
    expect(payload.selectedElement?.id).toBe('hero');
    expect(payload.recentConsoleLogs.some((entry) => entry.level === 'error' && entry.args[0] === 'paint failed')).toBe(
      true,
    );
    expect(payload.recentErrors.map((entry) => entry.type)).toEqual(['console_error', 'runtime']);
    expect(payload.failedNetworkRequests).toEqual([]);
  });

  it('drops errors older than two minutes', async () => {
    console.error = (() => undefined) as typeof console.error;
    installContextCollectors();
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now - 3 * 60 * 1000);
    console.error('stale');
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const payload = await gatherContext(undefined, null, { screenshot: false, now, maxAgeMs: 2 * 60 * 1000 });
    expect(payload.recentErrors).toEqual([]);
    expect(payload.recentConsoleLogs).toEqual([]);
  });

  it('omits the screenshot when capture fails', async () => {
    installContextCollectors();
    vi.mocked(toPng).mockRejectedValue(new Error('cors'));
    const button = document.createElement('button');
    const payload = await gatherContext(locateElement(button), button);
    expect(payload.screenshotBase64).toBeUndefined();
    expect(FrontendContextPayloadSchema.parse(payload)).toEqual(payload);
  });

  it('records failed XHR with redacted query values and a 4xx body preview', async () => {
    class FakeXHR {
      static UNSENT = 0;
      static OPENED = 1;
      static HEADERS_RECEIVED = 2;
      static LOADING = 3;
      static DONE = 4;
      readyState = FakeXHR.DONE;
      status = 401;
      responseText = '{"error":"nope"}';
      method = '';
      url = '';
      private readonly listeners = new Map<string, Array<() => void>>();
      open(method: string, url: string): void {
        this.method = method;
        this.url = url;
      }
      send(): void {
        queueMicrotask(() => {
          for (const listener of this.listeners.get('loadend') ?? []) listener();
        });
      }
      addEventListener(type: string, listener: () => void): void {
        const list = this.listeners.get(type) ?? [];
        list.push(listener);
        this.listeners.set(type, list);
      }
      getResponseHeader(name: string): string | null {
        return name.toLowerCase() === 'content-type' ? 'application/json' : null;
      }
    }
    const proto = FakeXHR.prototype as unknown as XMLHttpRequest;
    Object.setPrototypeOf(proto, XMLHttpRequest.prototype);
    vi.stubGlobal('XMLHttpRequest', FakeXHR);
    installContextCollectors({ gatewayUrl: 'http://127.0.0.1:4100' });

    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'https://api.test/login?token=super-secret');
    xhr.send();
    await vi.waitFor(() => expect(getFailedNetworkRequests().length).toBe(1));
    expect(getFailedNetworkRequests()[0]).toMatchObject({
      method: 'POST',
      status: 401,
      bodyPreview: '{"error":"nope"}',
    });
    expect(getFailedNetworkRequests()[0]?.url).toContain('token=REDACTED');
    expect(getFailedNetworkRequests()[0]?.url).not.toContain('super-secret');
  });

  it('records failed fetches and ignores the gateway origin', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('127.0.0.1:4100')) return new Response('down', { status: 500 });
      return new Response('{"error":"nope"}', {
        status: 503,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    installContextCollectors({ gatewayUrl: 'http://127.0.0.1:4100' });

    await fetch('https://example.test/api?auth=abc123');
    await fetch('http://127.0.0.1:4100/health');

    expect(getFailedNetworkRequests()).toEqual([
      expect.objectContaining({
        url: expect.stringContaining('auth=REDACTED'),
        status: 503,
        durationMs: expect.any(Number),
        method: 'GET',
        bodyPreview: '{"error":"nope"}',
      }),
    ]);
    expect(getFailedNetworkRequests()[0]?.url).not.toContain('abc123');
  });
});
