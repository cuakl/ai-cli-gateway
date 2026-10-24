import type { Run, Thread, UnifiedStreamEvent, WorkspaceServerMessage } from '@aidev/protocol';
import { toPng } from 'html-to-image';
import { options } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uninstallContextCollectors } from '../src/context/index.js';
import { HIGHLIGHT_ID, HIGHLIGHT_LABEL_ID, MARGIN_BOX_ID, PADDING_BOX_ID } from '../src/inspector/picker.js';
import { BADGE_LAYER_ID } from '../src/inspector/badges.js';
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
    document.getElementById(HIGHLIGHT_LABEL_ID)?.remove();
    document.getElementById(MARGIN_BOX_ID)?.remove();
    document.getElementById(PADDING_BOX_ID)?.remove();
    document.getElementById(BADGE_LAYER_ID)?.remove();
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
    const label = document.getElementById(HIGHLIGHT_LABEL_ID);
    expect(label?.textContent).toContain('HeroButton · Hero.tsx:42');
    expect(label?.textContent).toContain('button 320×48');
    expect(highlight?.style.pointerEvents).toBe('none');

    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 12, clientY: 22 }));
    expect(hostClicked).toBe(false);
    expect(shadow?.textContent).toContain('HeroButton · Hero.tsx:42');
    await vi.waitFor(() => expect(shadow?.querySelector('[data-chip="screenshot"]')).toBeTruthy(), {
      timeout: 3_000,
    });

    const suggestion = [...(shadow?.querySelectorAll('[data-action="suggestion"]') ?? [])].find((node) =>
      node.textContent?.includes('hover'),
    ) as HTMLButtonElement | undefined;
    suggestion?.click();
    const textarea = shadow?.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.value).toBe('Add a hover state to this button');
    textarea.value = 'Make it emerald';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    const send = shadow?.querySelector('[data-action="send"]') as HTMLButtonElement;
    send.click();
    await vi.waitFor(() => expect(shadow?.textContent).toContain('Updated the button'));
    const start = workspace.sent.find((message) => message.type === 'run.start');
    expect(start?.type === 'run.start' ? start.prompt : '').toBe('Make it emerald');
    expect(start?.type === 'run.start' ? start.context.selectedElement?.tagName : '').toBe('BUTTON');
    expect(start?.type === 'run.start' ? start.attachments : null).toEqual([
      { kind: 'image', mime: 'image/png', dataUrl: 'data:image/png;base64,overlay' },
    ]);
    expect(start?.type === 'run.start' ? start.context.screenshotBase64 : undefined).toBeUndefined();
    expect(start?.type === 'run.start' ? start.mode : '').toBe('agent');
    expect(start?.type === 'run.start' ? start.prompt : '').not.toContain('<frontend_context>');
    expect(toPng).toHaveBeenCalled();
    button.remove();
  });

  it('sends every shift-selected element on run.start', async () => {
    const workspace = createFakeWorkspace({
      onRequest(message, emit) {
        if (message.type !== 'run.start') return undefined;
        queueMicrotask(() => {
          emit(runEvent(message.requestId, 'done'));
        });
        return { type: 'run.accepted', requestId: message.requestId, threadId: 'thr_1', runId: 'run_1' };
      },
    });
    const host = initDevtools({ workspace });
    const shadow = host?.shadowRoot;
    const inspect = shadow?.querySelector('[data-action="inspect"]') as HTMLButtonElement;
    inspect.click();

    const first = document.createElement('strong');
    first.id = 'price-86';
    first.textContent = '$86';
    first.setAttribute('data-loc', 'src/components/CardGrid.tsx:30:12');
    const second = document.createElement('strong');
    second.id = 'price-42';
    second.textContent = '$42';
    second.setAttribute('data-loc', 'src/components/CardGrid.tsx:30:12');
    document.body.append(first, second);
    vi.spyOn(first, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 40, 16));
    vi.spyOn(second, 'getBoundingClientRect').mockReturnValue(new DOMRect(120, 20, 40, 16));
    const fromPoint = vi.spyOn(document, 'elementFromPoint');
    fromPoint.mockReturnValue(first);

    first.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 12, clientY: 22 }));
    first.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 12, clientY: 22 }));
    await vi.waitFor(() => expect(shadow?.querySelectorAll('[data-chip="selection"]').length).toBe(1));

    inspect.click();
    fromPoint.mockReturnValue(second);
    second.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 122, clientY: 22 }));
    second.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 122, clientY: 22, shiftKey: true }),
    );
    await vi.waitFor(() => expect(shadow?.querySelectorAll('[data-chip="selection"]').length).toBe(2));

    const textarea = shadow?.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'Restyle both prices';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    (shadow?.querySelector('[data-action="send"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(workspace.sent.some((message) => message.type === 'run.start')).toBe(true));
    const start = workspace.sent.find((message) => message.type === 'run.start');
    expect(start?.type === 'run.start' ? start.context.selectedElement?.id : '').toBe('price-86');
    expect(start?.type === 'run.start' ? start.context.selectedElements?.map((item) => item.id) : []).toEqual([
      'price-86',
      'price-42',
    ]);
    first.remove();
    second.remove();
  });

  it('shows a screenshot thumbnail that opens annotate with labeled tools', async () => {
    const workspace = createFakeWorkspace();
    const host = initDevtools({ workspace });
    const shadow = host?.shadowRoot;
    const inspect = shadow?.querySelector('[data-action="inspect"]') as HTMLButtonElement;
    inspect.click();
    const button = document.createElement('button');
    button.id = 'shot-target';
    button.setAttribute('data-loc', 'src/components/Hero.tsx:11:4');
    document.body.append(button);
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 100, 40));
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(button);
    button.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 12, clientY: 22 }));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 12, clientY: 22 }));
    await vi.waitFor(() => expect(shadow?.querySelector('[data-chip="screenshot"]')).toBeTruthy());
    const thumb = shadow?.querySelector('[data-action="screenshot-preview"] img') as HTMLImageElement;
    expect(thumb).toBeTruthy();
    expect(thumb.getAttribute('width')).toBe('32');
    expect(thumb.getAttribute('height')).toBe('20');
    (shadow?.querySelector('[data-action="screenshot-preview"]') as HTMLButtonElement).click();
    expect(shadow?.querySelector('[data-action="screenshot-preview-popover"]')).toBeTruthy();
    expect(shadow?.querySelector('[data-action="annotate-screenshot"]')?.textContent).toContain('Annotate');
    expect(shadow?.querySelector('[data-action="remove-screenshot-preview"]')?.textContent).toContain('Remove');
    (shadow?.querySelector('[data-action="annotate-screenshot"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(shadow?.querySelector('[data-action="annotate-layer"]')).toBeTruthy());
    const pen = shadow?.querySelector('[data-action="annotate-pen"]') as HTMLButtonElement;
    expect(pen.getAttribute('aria-label')).toBe('Pen');
    expect(pen.getAttribute('title')).toBe('Pen');
    expect(pen.getAttribute('aria-pressed')).toBe('true');
    expect(pen.querySelector('svg')).toBeTruthy();
    expect(shadow?.querySelector('[data-action="annotate-arrow"] svg')).toBeTruthy();
    expect(shadow?.querySelector('[data-action="annotate-rect"] svg')).toBeTruthy();
    expect(shadow?.querySelector('[data-action="annotate-text"] svg')).toBeTruthy();
    expect(shadow?.querySelector('[data-action="annotate-undo"] svg')).toBeTruthy();
    expect(shadow?.querySelector('.annotate-image')).toBeTruthy();
    button.remove();
  });

  it('sends editor.open on option-click while inspecting', async () => {
    const workspace = createFakeWorkspace();
    const host = initDevtools({ workspace });
    const shadow = host?.shadowRoot;
    (shadow?.querySelector('[data-action="inspect"]') as HTMLButtonElement).click();
    const button = document.createElement('button');
    button.setAttribute('data-loc', 'src/components/Hero.tsx:11:4');
    document.body.appendChild(button);
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(button);
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 100, 40));
    button.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 12, clientY: 22 }));
    button.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 12, clientY: 22, altKey: true }),
    );
    await vi.waitFor(() => expect(workspace.sent.some((message) => message.type === 'editor.open')).toBe(true));
    expect(workspace.sent.find((message) => message.type === 'editor.open')).toMatchObject({
      type: 'editor.open',
      file: 'src/components/Hero.tsx',
      line: 11,
      column: 4,
    });
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

  it('clears the composer draft once run.start is accepted', async () => {
    const workspace = createFakeWorkspace({
      state: 'open',
      onRequest(message, emit) {
        if (message.type !== 'run.start') return undefined;
        queueMicrotask(() => {
          emit(runEvent(message.requestId, 'chunk', { text: 'Updated', segment: 0 }));
          emit(runEvent(message.requestId, 'done'));
        });
        return { type: 'run.accepted', requestId: message.requestId, threadId: 'thr_1', runId: 'run_1' };
      },
    });
    const host = initDevtools({ workspace, projectId: 'proj_draft' });
    const shadow = host?.shadowRoot;
    (shadow?.querySelector('[data-action="chat"]') as HTMLButtonElement).click();
    const textarea = shadow?.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'Make it emerald';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    (shadow?.querySelector('[data-action="send"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(textarea.value).toBe(''));
    await vi.waitFor(() => expect(shadow?.textContent).toContain('Updated'));
    expect(JSON.parse(sessionStorage.getItem('aidev:session:proj_draft') ?? '{}')).toMatchObject({
      prompt: '',
      threadId: 'thr_1',
    });
  });

  it('restores the transcript after unmount when the session still has a threadId', async () => {
    const storedRun = sampleRun('run_1', 'thr_1', 'Make it emerald', 'succeeded');
    const workspace = createFakeWorkspace({
      state: 'open',
      onRequest(message, emit) {
        if (message.type === 'thread.get' && message.threadId === 'thr_1') {
          return {
            type: 'thread.get.result',
            requestId: message.requestId,
            thread: sampleThread('thr_1'),
            runs: [storedRun],
            events: [
              threadEvent('run_1', 'chunk', { text: 'Updated the button', segment: 0 }),
              threadEvent('run_1', 'done', {}),
            ],
          };
        }
        if (message.type !== 'run.start') return undefined;
        queueMicrotask(() => {
          emit(runEvent(message.requestId, 'chunk', { text: 'Updated the button', segment: 0 }));
          emit(runEvent(message.requestId, 'done'));
        });
        return { type: 'run.accepted', requestId: message.requestId, threadId: 'thr_1', runId: 'run_1' };
      },
    });
    const first = initDevtools({ workspace, projectId: 'proj_restore' });
    const firstShadow = first?.shadowRoot;
    (firstShadow?.querySelector('[data-action="chat"]') as HTMLButtonElement).click();
    const textarea = firstShadow?.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'Make it emerald';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    (firstShadow?.querySelector('[data-action="send"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(firstShadow?.textContent).toContain('Updated the button'));
    expect(textarea.value).toBe('');
    await vi.waitFor(() =>
      expect(JSON.parse(sessionStorage.getItem('aidev:session:proj_restore') ?? '{}').threadId).toBe('thr_1'),
    );
    first?.remove();

    const second = initDevtools({ workspace, projectId: 'proj_restore' });
    const shadow = second?.shadowRoot;
    await vi.waitFor(() =>
      expect(shadow?.querySelector('[data-kind="user"]')?.textContent ?? '').toContain('Make it emerald'),
    );
    expect(shadow?.querySelector('[data-kind="assistant"]')?.textContent).toContain('Updated the button');
    expect((shadow?.querySelector('textarea') as HTMLTextAreaElement).value).toBe('');
  });

  it('attaches an active run after reload and shows the stop button', async () => {
    const storedRun = sampleRun('run_1', 'thr_1', 'Keep going', 'running');
    const workspace = createFakeWorkspace({
      state: 'open',
      onRequest(message) {
        if (message.type === 'thread.get' && message.threadId === 'thr_1') {
          return {
            type: 'thread.get.result',
            requestId: message.requestId,
            thread: sampleThread('thr_1'),
            runs: [storedRun],
            events: [threadEvent('run_1', 'chunk', { text: 'Hello', segment: 0 })],
          };
        }
        if (message.type !== 'run.start') return undefined;
        return { type: 'run.accepted', requestId: message.requestId, threadId: 'thr_1', runId: 'run_1' };
      },
      onSend(message, emit) {
        if (message.type !== 'run.attach') return;
        emit(runEvent(message.requestId, 'chunk', { text: 'Hello', segment: 0 }));
        emit({
          type: 'run.event',
          requestId: message.requestId,
          runId: 'run_1',
          event: {
            id: 'evt_world',
            sessionId: 'sess_1',
            type: 'chunk',
            timestamp: 2,
            payload: { text: 'World', segment: 0 },
          },
        });
      },
    });
    const first = initDevtools({ workspace, projectId: 'proj_attach' });
    const firstShadow = first?.shadowRoot;
    (firstShadow?.querySelector('[data-action="chat"]') as HTMLButtonElement).click();
    const textarea = firstShadow?.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'Keep going';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    (firstShadow?.querySelector('[data-action="send"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(firstShadow?.querySelector('[data-action="stop"]')).toBeTruthy());
    await vi.waitFor(() =>
      expect(JSON.parse(sessionStorage.getItem('aidev:session:proj_attach') ?? '{}')).toMatchObject({
        threadId: 'thr_1',
        runId: 'run_1',
        prompt: '',
      }),
    );
    first?.remove();

    const second = initDevtools({ workspace, projectId: 'proj_attach' });
    const shadow = second?.shadowRoot;
    await vi.waitFor(() => expect(workspace.sent.some((message) => message.type === 'run.attach')).toBe(true));
    await vi.waitFor(() => expect(shadow?.querySelector('[data-action="stop"]')).toBeTruthy());
    await vi.waitFor(() => expect(shadow?.querySelector('[data-kind="user"]')?.textContent).toContain('Keep going'));
    await vi.waitFor(() => expect(shadow?.textContent).toContain('Hello'));
    await vi.waitFor(() => expect(shadow?.textContent).toContain('World'));
  });
});

function sampleThread(id: string): Thread {
  return {
    id,
    projectId: 'proj_restore',
    provider: 'cursor',
    model: null,
    mode: 'agent',
    providerSessionId: null,
    title: 'Make it emerald',
    createdAt: 1,
    updatedAt: 2,
    keep: true,
    source: 'overlay',
  };
}

function sampleRun(id: string, threadId: string, prompt: string, status: Run['status']): Run {
  return {
    id,
    threadId,
    prompt,
    contextSummary: null,
    attachments: [],
    status,
    startedAt: 1,
    endedAt: status === 'running' || status === 'queued' ? null : 2,
    checkpoint: null,
    filesTouched: [],
    error: null,
    usage: status === 'succeeded' ? { durationMs: 8 } : null,
  };
}

function threadEvent(
  runId: string,
  type: UnifiedStreamEvent['type'],
  payload: UnifiedStreamEvent['payload'] = {},
): { runId: string; event: UnifiedStreamEvent } {
  return {
    runId,
    event: {
      id: `evt_${type}_${String(payload.segment ?? 'n')}`,
      sessionId: 'sess_1',
      type,
      timestamp: 1,
      payload,
    },
  };
}

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
