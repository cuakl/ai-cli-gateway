import type { Thread, UnifiedStreamEvent, WorkspaceClientMessage, WorkspaceServerMessage } from '@aidev/protocol';
import { options } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uninstallContextCollectors } from '../src/context/index.js';
import { initDevtools } from '../src/index.js';
import { insertMention, mentionToken } from '../src/ui/chat/Composer.js';
import { createFakeWorkspace } from './fake-workspace.js';

options.debounceRendering = (callback) => {
  callback();
};

vi.mock('html-to-image', () => ({
  toPng: vi.fn(async () => 'data:image/png;base64,composer'),
}));

describe('mention helpers', () => {
  it('finds the @ token at the caret and inserts a path', () => {
    expect(mentionToken('see @he', 7)).toEqual({ start: 4, query: 'he' });
    expect(mentionToken('email@x', 7)).toBeNull();
    expect(insertMention('see @he', 7, '@src/Hero.tsx')).toEqual({
      text: 'see @src/Hero.tsx ',
      caret: 18,
    });
  });
});

describe('composer', () => {
  afterEach(() => {
    uninstallContextCollectors();
    document.querySelector('ai-devtools')?.remove();
    vi.restoreAllMocks();
  });

  it('excludes removed chips from the next run.start', async () => {
    const workspace = createStreamingWorkspace();
    const host = initDevtools({ workspace });
    const shadow = host?.shadowRoot;
    console.error('paint failed');
    (shadow?.querySelector('[data-action="chat"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(shadow?.querySelector('[data-chip="console"]')).toBeTruthy());
    (shadow?.querySelector('[data-chip-id="console"]') as HTMLButtonElement).click();
    expect(shadow?.querySelector('[data-chip="console"]')).toBeNull();

    await typePrompt(shadow, 'Fix the layout');
    (shadow?.querySelector('[data-action="send"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(startMessages(workspace).length).toBe(1));
    const start = startMessages(workspace)[0];
    expect(start?.context.recentErrors).toEqual([]);
    expect(start?.context.recentConsoleLogs).toEqual([]);
  });

  it('opens an @ mention listbox and inserts a file with the keyboard', async () => {
    const workspace = createStreamingWorkspace({
      onRequest(message) {
        if (message.type === 'files.search') {
          return {
            type: 'files.search.result',
            requestId: message.requestId,
            files: ['src/Hero.tsx', 'src/App.tsx'],
          };
        }
        return undefined;
      },
    });
    const host = initDevtools({ workspace });
    const shadow = host?.shadowRoot;
    (shadow?.querySelector('[data-action="chat"]') as HTMLButtonElement).click();
    const textarea = shadow?.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '@';
    textarea.setSelectionRange(1, 1);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() =>
      expect(workspace.sent.some((message) => message.type === 'files.search')).toBe(true),
    );
    const search = workspace.sent.find((message) => message.type === 'files.search');
    expect(search).toMatchObject({ type: 'files.search', query: '' });
    await vi.waitFor(() => expect(shadow?.querySelector('[data-action="mention-listbox"]')).toBeTruthy());
    expect(shadow?.querySelector('[data-mention="file:src/Hero.tsx"]')?.textContent).toBe('src/Hero.tsx');

    const first = shadow?.querySelector('[data-action="mention-listbox"] [aria-selected="true"]');
    expect(first?.getAttribute('data-mention')).toBe('file:src/Hero.tsx');
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    const active = shadow?.querySelector('[data-action="mention-listbox"] [aria-selected="true"]');
    expect(active?.getAttribute('data-mention')).toBe('file:src/App.tsx');
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(textarea.value).toContain('@src/App.tsx');
    expect(shadow?.querySelector('[data-action="mention-listbox"]')).toBeNull();
    (shadow?.querySelector('[data-action="send"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(startMessages(workspace).length).toBe(1));
    expect(startMessages(workspace)[0]?.prompt).toContain('@src/App.tsx');

    await vi.waitFor(() => expect((shadow?.querySelector('[data-action="send"]') as HTMLButtonElement).disabled).toBe(true));
    textarea.value = '@';
    textarea.setSelectionRange(1, 1);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(shadow?.querySelector('[data-action="mention-listbox"]')).toBeTruthy());
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(shadow?.querySelector('[data-action="mention-listbox"]')).toBeNull();
    expect(shadow?.querySelector('textarea')).toBeTruthy();
  });

  it('sends the chosen provider, model, and mode', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          status: 'ok',
          version: '0.0.0',
          providers: [
            {
              provider: 'cursor',
              available: true,
              binaryPath: '/bin/cursor',
              version: '1',
              verified: true,
              modes: ['agent', 'ask'],
              models: [{ id: 'gpt-5', label: 'GPT-5' }],
              supportsResume: true,
              supportsImages: false,
              supportsJsonSchema: false,
              supportsSystemPrompt: true,
            },
            {
              provider: 'claude',
              available: true,
              binaryPath: '/bin/claude',
              version: '1',
              verified: true,
              modes: ['agent', 'ask', 'plan'],
              models: [
                { id: 'sonnet', label: 'sonnet' },
                { id: 'opus', label: 'opus' },
              ],
              supportsResume: true,
              supportsImages: false,
              supportsJsonSchema: false,
              supportsSystemPrompt: true,
            },
            {
              provider: 'codex',
              available: false,
              binaryPath: null,
              version: null,
              verified: false,
              modes: ['agent', 'ask'],
              models: [],
              supportsResume: false,
              supportsImages: false,
              supportsJsonSchema: false,
              supportsSystemPrompt: false,
              setup: ['Install Codex'],
            },
            {
              provider: 'antigravity',
              available: true,
              binaryPath: '/bin/agy',
              version: null,
              verified: false,
              modes: ['agent'],
              models: [],
              supportsResume: false,
              supportsImages: false,
              supportsJsonSchema: false,
              supportsSystemPrompt: false,
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const workspace = createStreamingWorkspace({ state: 'open' });
    const host = initDevtools({
      workspace,
      gatewayUrl: 'http://127.0.0.1:4100',
      browserToken: 'tok_test',
    });
    const shadow = host?.shadowRoot;
    (shadow?.querySelector('[data-action="chat"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(shadow?.querySelector('option[value="gpt-5"]')).toBeTruthy());

    const provider = shadow?.querySelector('[data-action="provider"]') as HTMLSelectElement;
    provider.value = 'claude';
    provider.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(shadow?.querySelector('option[value="sonnet"]')).toBeTruthy());
    expect((shadow?.querySelector('[data-action="model"]') as HTMLSelectElement).value).toBe('');

    const model = shadow?.querySelector('[data-action="model"]') as HTMLSelectElement;
    model.value = 'sonnet';
    model.dispatchEvent(new Event('change', { bubbles: true }));
    const mode = shadow?.querySelector('[data-action="mode"]') as HTMLSelectElement;
    mode.value = 'ask';
    mode.dispatchEvent(new Event('change', { bubbles: true }));

    const codex = shadow?.querySelector('option[value="codex"]') as HTMLOptionElement;
    expect(codex.disabled).toBe(true);
    expect(codex.textContent).toContain('not installed');
    const antigravity = shadow?.querySelector('option[value="antigravity"]') as HTMLOptionElement;
    expect(antigravity.disabled).toBe(false);
    expect(antigravity.textContent).toContain('experimental');

    await typePrompt(shadow, 'Where is this styled?');
    (shadow?.querySelector('[data-action="send"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(startMessages(workspace).length).toBe(1));
    expect(startMessages(workspace)[0]).toMatchObject({
      type: 'run.start',
      provider: 'claude',
      model: 'sonnet',
      mode: 'ask',
      prompt: 'Where is this styled?',
    });
  });

  it('shows suggestions only on an empty thread', async () => {
    const workspace = createStreamingWorkspace();
    const host = initDevtools({ workspace });
    const shadow = host?.shadowRoot;
    (shadow?.querySelector('[data-action="chat"]') as HTMLButtonElement).click();
    expect(shadow?.querySelector('[data-action="suggestion"]')).toBeNull();

    const inspect = shadow?.querySelector('[data-action="inspect"]') as HTMLButtonElement;
    inspect.click();
    const button = document.createElement('button');
    button.textContent = 'Go';
    button.setAttribute('data-loc', 'src/Hero.tsx:11:1');
    document.body.append(button);
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 80, 32));
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(button);
    button.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 12, clientY: 22 }));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 12, clientY: 22 }));

    const suggestions = [...(shadow?.querySelectorAll('[data-action="suggestion"]') ?? [])].map((node) => node.textContent);
    expect(suggestions).toContain('Make `Hero` responsive');
    expect(suggestions).toContain('Add a hover state to this button');
    (shadow?.querySelector('[data-action="suggestion"]') as HTMLButtonElement).click();
    expect((shadow?.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Make `Hero` responsive');

    (shadow?.querySelector('[data-action="send"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(shadow?.querySelector('[data-action="suggestion"]')).toBeNull());
    button.remove();
  });

  it('resets threadId when starting a new chat', async () => {
    const workspace = createStreamingWorkspace();
    const host = initDevtools({ workspace });
    const shadow = host?.shadowRoot;
    (shadow?.querySelector('[data-action="chat"]') as HTMLButtonElement).click();
    await typePrompt(shadow, 'First turn');
    (shadow?.querySelector('[data-action="send"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(startMessages(workspace).length).toBe(1));
    expect(startMessages(workspace)[0]?.threadId).toBeUndefined();
    await vi.waitFor(() => expect(shadow?.textContent).toContain('First turn'));

    await typePrompt(shadow, 'Follow up');
    (shadow?.querySelector('[data-action="send"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(startMessages(workspace).length).toBe(2));
    expect(startMessages(workspace)[1]?.threadId).toBe('thr_1');

    (shadow?.querySelector('[data-action="new-chat"]') as HTMLButtonElement).click();
    await typePrompt(shadow, 'Brand new');
    (shadow?.querySelector('[data-action="send"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(startMessages(workspace).length).toBe(3));
    expect(startMessages(workspace)[2]?.threadId).toBeUndefined();
  });

  it('resumes a history thread and sends its threadId on the next run', async () => {
    const thread = sampleThread('thr_hist', 'Make it blue');
    const workspace = createStreamingWorkspace({
      onRequest(message) {
        if (message.type === 'thread.list') {
          return {
            type: 'thread.list.result',
            requestId: message.requestId,
            threads: [{ ...thread, runCount: 1 }],
          };
        }
        if (message.type === 'thread.get' && message.threadId === 'thr_hist') {
          return {
            type: 'thread.get.result',
            requestId: message.requestId,
            thread,
            runs: [
              {
                id: 'run_old',
                threadId: 'thr_hist',
                prompt: 'Make it blue',
                contextSummary: null,
                attachments: [],
                status: 'succeeded',
                startedAt: 10,
                endedAt: 20,
                checkpoint: null,
                filesTouched: [],
                error: null,
                usage: { durationMs: 10 },
              },
            ],
            events: [
              threadEvent('run_old', 'chunk', { text: 'Done.', segment: 0 }),
              threadEvent('run_old', 'done', {}),
            ],
          };
        }
        return undefined;
      },
    });
    const host = initDevtools({ workspace });
    const shadow = host?.shadowRoot;
    (shadow?.querySelector('[data-action="chat"]') as HTMLButtonElement).click();
    (shadow?.querySelector('[data-action="history"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(shadow?.querySelector('[data-thread-id="thr_hist"]')).toBeTruthy());
    expect(shadow?.textContent).toContain('Make it blue');
    expect(shadow?.textContent).toContain('1 run');
    expect(workspace.sent.filter((message) => message.type === 'thread.get')).toHaveLength(0);
    (shadow?.querySelector('[data-thread-id="thr_hist"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(shadow?.textContent).toContain('Done.'));
    await typePrompt(shadow, 'now make it bigger');
    (shadow?.querySelector('[data-action="send"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(startMessages(workspace).length).toBe(1));
    expect(startMessages(workspace)[0]?.threadId).toBe('thr_hist');
    expect(startMessages(workspace)[0]?.prompt).toBe('now make it bigger');
  });
});

function startMessages(workspace: { sent: WorkspaceClientMessage[] }): Array<Extract<WorkspaceClientMessage, { type: 'run.start' }>> {
  return workspace.sent.filter((message): message is Extract<WorkspaceClientMessage, { type: 'run.start' }> => {
    return message.type === 'run.start';
  });
}

async function typePrompt(shadow: ShadowRoot | null | undefined, text: string): Promise<void> {
  const textarea = shadow?.querySelector('textarea') as HTMLTextAreaElement;
  textarea.value = text;
  textarea.setSelectionRange(text.length, text.length);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function createStreamingWorkspace(
  options: {
    state?: 'open' | 'closed' | 'connecting';
    onRequest?: (
      message: WorkspaceClientMessage,
      emit: (message: WorkspaceServerMessage) => void,
    ) => WorkspaceServerMessage | undefined;
  } = {},
) {
  return createFakeWorkspace({
    state: options.state,
    onRequest(message, emit) {
      const custom = options.onRequest?.(message, emit);
      if (custom) return custom;
      if (message.type !== 'run.start') return undefined;
      queueMicrotask(() => {
        emit({
          type: 'run.event',
          requestId: message.requestId,
          runId: 'run_1',
          event: {
            id: 'evt_done',
            sessionId: 'sess_1',
            type: 'done',
            timestamp: 1,
            payload: {},
          },
        });
      });
      return { type: 'run.accepted', requestId: message.requestId, threadId: 'thr_1', runId: 'run_1' };
    },
  });
}

function sampleThread(id: string, title: string): Thread {
  return {
    id,
    projectId: 'proj_test',
    provider: 'cursor',
    model: null,
    mode: 'agent',
    providerSessionId: null,
    title,
    createdAt: Date.now() - 60_000,
    updatedAt: Date.now() - 60_000,
    keep: true,
    source: 'overlay',
  };
}

function threadEvent(
  runId: string,
  type: UnifiedStreamEvent['type'],
  payload: UnifiedStreamEvent['payload'],
): { runId: string; event: UnifiedStreamEvent } {
  return {
    runId,
    event: {
      id: `evt_${type}`,
      sessionId: 'sess_hist',
      type,
      timestamp: 1,
      payload,
    },
  };
}
