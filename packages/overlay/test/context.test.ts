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

  it('omits the screenshot when capture fails', async () => {
    installContextCollectors();
    vi.mocked(toPng).mockRejectedValue(new Error('cors'));
    const button = document.createElement('button');
    const payload = await gatherContext(locateElement(button), button);
    expect(payload.screenshotBase64).toBeUndefined();
    expect(FrontendContextPayloadSchema.parse(payload)).toEqual(payload);
  });

  it('records failed fetches and ignores the gateway origin', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('127.0.0.1:4100')) return new Response('down', { status: 500 });
      return new Response('nope', { status: 503 });
    });
    vi.stubGlobal('fetch', fetchMock);
    installContextCollectors({ gatewayUrl: 'http://127.0.0.1:4100' });

    await fetch('https://example.test/api');
    await fetch('http://127.0.0.1:4100/health');

    expect(getFailedNetworkRequests()).toEqual([
      expect.objectContaining({ url: 'https://example.test/api', status: 503, durationMs: expect.any(Number) }),
    ]);
  });
});
