import type { UnifiedStreamEvent, WorkspaceServerMessage } from '@aidev/protocol';
import { toPng } from 'html-to-image';
import { options } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uninstallContextCollectors } from '../src/context/index.js';
import { HIGHLIGHT_ID } from '../src/inspector/picker.js';
import { initDevtools } from '../src/index.js';
import { createFakeWorkspace } from './fake-workspace.js';

options.debounceRendering = (callback) => {
  callback();
};

vi.mock('html-to-image', () => ({
  toPng: vi.fn(async () => 'data:image/png;base64,overlay'),
}));

describe('initDevtools', () => {
  afterEach(() => {
    uninstallContextCollectors();
    document.querySelector('ai-devtools')?.remove();
    document.getElementById(HIGHLIGHT_ID)?.remove();
    document.documentElement.style.cursor = '';
    delete (globalThis as { __AI_DEVTOOLS__?: unknown }).__AI_DEVTOOLS__;
    vi.restoreAllMocks();
  });

  it('mounts one shadow root and does not duplicate the host', () => {
    const first = initDevtools({ gatewayUrl: 'http://127.0.0.1:4100', workspace: createFakeWorkspace() });
    const second = initDevtools({ workspace: createFakeWorkspace() });
    expect(first).toBe(second);
    expect(document.querySelectorAll('ai-devtools')).toHaveLength(1);
    const shadow = first?.shadowRoot;
    expect(shadow?.querySelector('#ai-devtools-root')).toBeTruthy();
    expect(shadow?.querySelector('style')?.textContent).toContain('#ai-devtools-root');
    expect(first?.style.fontFamily).toContain('ui-sans-serif');
    expect(first?.style.color.toLowerCase()).toBe('#e7e9ee');
    expect(first?.style.fontSize).toBe('14px');
    expect(first?.getAttribute('data-theme')).toBe('dark');
    expect(shadow?.querySelector('[data-action="inspect"]')).toBeTruthy();
    expect(document.querySelector('#ai-devtools-root')).toBeNull();
  });

  it('inspects an element and streams the workspace reply into the drawer', async () => {
    const workspace = createFakeWorkspace({
      onRequest(message, emit) {
        if (message.type !== 'run.start') return undefined;
        queueMicrotask(() => {
          emit(runEvent(message.requestId, 'chunk', { text: 'Updated the button', segment: 0 }));
          emit(runEvent(message.requestId, 'done'));
        });
        return { type: 'run.accepted', requestId: message.requestId, threadId: 'thr_1', runId: 'run_1' };
      },
    });
    const host = initDevtools({ workspace });
    const shadow = host?.shadowRoot;
    expect(shadow).toBeTruthy();

    const inspect = shadow?.querySelector('[data-action="inspect"]') as HTMLButtonElement;
    inspect.click();
    expect(inspect.getAttribute('aria-pressed')).toBe('true');

    const button = document.createElement('button');
    button.id = 'hero';
    button.className = 'btn';
    button.textContent = 'Get started';
    button.setAttribute('data-loc', 'src/components/Hero.tsx:42:5');
    Object.assign(button, {
      __reactFiber$demo: {
        return: {
          type: { displayName: 'HeroButton' },
          memoizedProps: { tone: 'primary' },
          _debugSource: {
            fileName: 'src/components/Hero.tsx',
            lineNumber: 42,
            columnNumber: 5,
          },
        },
      },
    });
    document.body.appendChild(button);
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 320, 48));
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(button);
    let hostClicked = false;
    button.addEventListener('click', () => {
      hostClicked = true;
    });

    button.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 12, clientY: 22 }));
    const highlight = document.getElementById(HIGHLIGHT_ID);
    expect(highlight?.textContent).toContain('button#hero.btn (320x48)');
    expect(highlight?.style.pointerEvents).toBe('none');

    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 12, clientY: 22 }));
    expect(hostClicked).toBe(false);
    expect(shadow?.textContent).toContain('[HeroButton - Hero.tsx:42]');

    const suggestion = [...(shadow?.querySelectorAll('button') ?? [])].find((node) => node.textContent === 'Fix layout');
    suggestion?.click();
    const textarea = shadow?.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.value).toBe('Fix layout');
    textarea.value = 'Make it emerald';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    const send = shadow?.querySelector('[data-action="send"]') as HTMLButtonElement;
    send.click();
    await vi.waitFor(() => expect(shadow?.textContent).toContain('Updated the button'));
    const start = workspace.sent.find((message) => message.type === 'run.start');
    expect(start?.type === 'run.start' ? start.prompt : '').toBe('Make it emerald');
    expect(start?.type === 'run.start' ? start.context.selectedElement?.tagName : '').toBe('BUTTON');
    expect(start?.type === 'run.start' ? start.context.screenshotBase64 : '').toContain('base64');
    expect(start?.type === 'run.start' ? start.attachments : null).toEqual([]);
    expect(start?.type === 'run.start' ? start.mode : '').toBe('agent');
    expect(start?.type === 'run.start' ? start.prompt : '').not.toContain('<frontend_context>');
    expect(toPng).toHaveBeenCalled();
    button.remove();
  });

  it('renders a segment -1 chunk as a notice line', async () => {
    const workspace = createFakeWorkspace({
      onRequest(message, emit) {
        if (message.type !== 'run.start') return undefined;
        queueMicrotask(() => {
          emit(runEvent(message.requestId, 'chunk', { text: 'Working tree is dirty', segment: -1 }));
          emit(runEvent(message.requestId, 'chunk', { text: 'Done editing', segment: 0 }));
          emit(runEvent(message.requestId, 'done'));
        });
        return { type: 'run.accepted', requestId: message.requestId, threadId: 'thr_1', runId: 'run_1' };
      },
    });
    const host = initDevtools({ workspace });
    const shadow = host?.shadowRoot;
    (shadow?.querySelector('[data-action="chat"]') as HTMLButtonElement).click();
    const textarea = shadow?.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'Tint the hero';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    (shadow?.querySelector('[data-action="send"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(shadow?.textContent).toContain('Done editing'));
    expect(shadow?.querySelector('.chat-notice')?.textContent).toContain('Working tree is dirty');
    const assistant = shadow?.querySelector('.assistant-item');
    expect(assistant?.textContent).toContain('Done editing');
    expect(assistant?.textContent).not.toContain('Working tree is dirty');
    expect(shadow?.querySelector('.messages')?.getAttribute('aria-live')).toBeNull();
  });

  it('opens the project socket from the config injected by the Vite plugin', () => {
    (globalThis as { __AI_DEVTOOLS__?: Record<string, string> }).__AI_DEVTOOLS__ = {
      gatewayUrl: 'http://127.0.0.1:4199',
      projectId: 'proj_demo',
      browserToken: 'tok_browser',
    };
    const sockets: Array<{ url: string }> = [];
    vi.stubGlobal(
      'WebSocket',
      class {
        constructor(url: string) {
          sockets.push(this);
          this.url = url;
        }
        url: string;
        readyState = 0;
        onopen: ((event: Event) => void) | null = null;
        onmessage: ((event: { data: unknown }) => void) | null = null;
        onerror: ((event: Event) => void) | null = null;
        onclose: ((event: Event) => void) | null = null;
        send(): void {}
        close(): void {
          this.readyState = 3;
          this.onclose?.(new Event('close'));
        }
      },
    );
    initDevtools();
    expect(sockets[0]?.url).toBe('ws://127.0.0.1:4199/api/v1/projects/proj_demo/ws?token=tok_browser');
  });

  it('prefers an explicit project id and token over the injected config', () => {
    (globalThis as { __AI_DEVTOOLS__?: Record<string, string> }).__AI_DEVTOOLS__ = {
      gatewayUrl: 'http://127.0.0.1:4199',
      projectId: 'proj_injected',
      browserToken: 'tok_injected',
    };
    const sockets: Array<{ url: string }> = [];
    vi.stubGlobal(
      'WebSocket',
      class {
        constructor(url: string) {
          sockets.push(this);
          this.url = url;
        }
        url: string;
        readyState = 0;
        onopen: ((event: Event) => void) | null = null;
        onmessage: ((event: { data: unknown }) => void) | null = null;
        onerror: ((event: Event) => void) | null = null;
        onclose: ((event: Event) => void) | null = null;
        send(): void {}
        close(): void {
          this.readyState = 3;
          this.onclose?.(new Event('close'));
        }
      },
    );
    initDevtools({
      gatewayUrl: 'http://127.0.0.1:4100',
      projectId: 'proj_explicit',
      browserToken: 'tok_explicit',
    });
    expect(sockets[0]?.url).toBe('ws://127.0.0.1:4100/api/v1/projects/proj_explicit/ws?token=tok_explicit');
  });

  it('follows the workspace connection on the status dot', () => {
    const workspace = createFakeWorkspace({ state: 'closed' });
    const host = initDevtools({ workspace });
    const dot = (): Element | null | undefined => host?.shadowRoot?.querySelector('.status');
    expect(dot()?.getAttribute('data-state')).toBe('idle');
    workspace.setState('open');
    expect(dot()?.getAttribute('data-state')).toBe('connected');
    workspace.setState('connecting');
    expect(dot()?.getAttribute('data-state')).toBe('idle');
    workspace.setState('closed');
    expect(dot()?.getAttribute('data-state')).toBe('idle');
  });

  it('disables send when the selected provider is not installed', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain('/api/v1/status');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer tok_test');
      return new Response(
        JSON.stringify({
          status: 'ok',
          version: '0.0.0',
          activeRuns: 0,
          projects: [],
          providers: [
            { provider: 'cursor', available: false, binaryPath: null },
            { provider: 'claude', available: false, binaryPath: null },
            { provider: 'antigravity', available: false, binaryPath: null },
            { provider: 'codex', available: false, binaryPath: null },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const host = initDevtools({
      workspace: createFakeWorkspace({ state: 'open' }),
      gatewayUrl: 'http://127.0.0.1:4100',
      browserToken: 'tok_test',
    });
    const shadow = host?.shadowRoot;
    (shadow?.querySelector('[data-action="chat"]') as HTMLButtonElement).click();
    const textarea = shadow?.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'Make it emerald';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => {
      const send = shadow?.querySelector('[data-action="send"]') as HTMLButtonElement;
      expect(send.disabled).toBe(true);
      expect(send.title).toContain('not on PATH');
    });
    const claude = shadow?.querySelector('option[value="claude"]') as HTMLOptionElement;
    expect(claude.disabled).toBe(true);
    expect(claude.textContent).toContain('not installed');
    expect(shadow?.querySelector('.hint')?.textContent).toContain('not on PATH');
    (shadow?.querySelector('[data-action="send"]') as HTMLButtonElement).click();
    expect(fetchMock).toHaveBeenCalled();
  });
});

function runEvent(
  requestId: string | undefined,
  type: UnifiedStreamEvent['type'],
  payload: UnifiedStreamEvent['payload'] = {},
): WorkspaceServerMessage {
  return {
    type: 'run.event',
    requestId,
    runId: 'run_1',
    event: {
      id: `evt_${type}_${String(payload.segment ?? 'n')}`,
      sessionId: 'sess_1',
      type,
      timestamp: 1,
      payload,
    },
  };
}
