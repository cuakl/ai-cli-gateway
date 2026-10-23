import { FrontendContextPayloadSchema } from '@aidev/protocol';
import { options } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';

options.debounceRendering = (callback) => {
  callback();
};

vi.mock('html-to-image', () => ({
  toPng: vi.fn(async () => 'data:image/png;base64,redact'),
}));
import {
  CONTEXT_JSON_LIMIT,
  gatherContext,
  installContextCollectors,
  uninstallContextCollectors,
} from '../src/context/index.js';
import { locateElement } from '../src/inspector/locator.js';
import { redactContext, redactUrl } from '../src/context/redact.js';
import { initDevtools } from '../src/index.js';
import { createFakeWorkspace } from './fake-workspace.js';

const originalConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error,
};

describe('context redaction', () => {
  afterEach(() => {
    uninstallContextCollectors();
    document.querySelector('ai-devtools')?.remove();
    document.querySelectorAll('input').forEach((node) => node.remove());
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    vi.unstubAllGlobals();
  });

  it('redacts sensitive query keys', () => {
    expect(redactUrl('https://api.test/v1?token=abc&id=1')).toContain('token=REDACTED');
    expect(redactUrl('https://api.test/v1?token=abc&id=1')).toContain('id=1');
    expect(redactUrl('/login?password=hunter2')).toContain('password=REDACTED');
  });

  it('never includes a password input value in gatherContext', async () => {
    const secret = 's3cret-passphrase';
    const input = document.createElement('input');
    input.type = 'password';
    input.setAttribute('value', secret);
    input.value = secret;
    document.body.append(input);
    installContextCollectors();
    const payload = await gatherContext(locateElement(input), input, { screenshot: false });
    expect(JSON.stringify(payload)).not.toContain(secret);
    expect(payload.selectedElement?.outerHTML.toLowerCase()).not.toContain(secret);
  });

  it('never includes a password input value in the composed run.start payload', async () => {
    const secret = 's3cret-passphrase';
    const workspace = createFakeWorkspace();
    const host = initDevtools({ workspace });
    const shadow = host?.shadowRoot;
    const input = document.createElement('input');
    input.type = 'password';
    input.id = 'login-pass';
    input.setAttribute('data-loc', 'src/Login.tsx:3:1');
    input.setAttribute('value', secret);
    input.value = secret;
    document.body.append(input);

    (shadow?.querySelector('[data-action="inspect"]') as HTMLButtonElement).click();
    vi.spyOn(input, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 80, 32));
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(input);
    input.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 12, clientY: 22 }));
    input.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 12, clientY: 22 }));

    const textarea = shadow?.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'Do not leak secrets';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    (shadow?.querySelector('[data-action="send"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(workspace.sent.some((message) => message.type === 'run.start')).toBe(true));
    const start = workspace.sent.find((message) => message.type === 'run.start');
    expect(JSON.stringify(start)).not.toContain(secret);
    expect(JSON.stringify(start?.context)).not.toContain(secret);
  });

  it('caps composed context JSON at 32 KB by dropping oldest logs first', () => {
    const bulky = 'x'.repeat(2_000);
    const payload = FrontendContextPayloadSchema.parse({
      recentConsoleLogs: Array.from({ length: 40 }, (_, index) => ({
        level: 'log' as const,
        args: [`${index}-${bulky}`],
        timestamp: index,
      })),
      recentErrors: [{ type: 'runtime' as const, message: 'keep-me', timestamp: 99 }],
      failedNetworkRequests: [],
    });
    const capped = redactContext(payload);
    expect(JSON.stringify(capped).length).toBeLessThanOrEqual(CONTEXT_JSON_LIMIT);
    expect(capped.recentConsoleLogs[0]?.args[0]?.startsWith('0-')).toBeFalsy();
    expect(capped.recentErrors.some((entry) => entry.message === 'keep-me')).toBe(true);
  });
});
