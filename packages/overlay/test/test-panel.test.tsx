import type { TestReport, UnifiedStreamEvent, WorkspaceServerMessage } from '@aidev/protocol';
import { options } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uninstallContextCollectors } from '../src/context/index.js';
import { initDevtools } from '../src/index.js';
import { PREFS_KEY } from '../src/ui/prefs.js';
import { parseExpectedReceived } from '../src/ui/test-report.js';
import { createFakeWorkspace } from './fake-workspace.js';

options.debounceRendering = (callback) => {
  callback();
};

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    loadAddon(): void {}
    open(): void {}
    onData(): { dispose(): void } {
      return { dispose() {} };
    }
    onResize(): { dispose(): void } {
      return { dispose() {} };
    }
    write(): void {}
    dispose(): void {}
  },
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit(): void {}
  },
}));

const FAIL_REPORT: TestReport = {
  summary: { passed: 1, failed: 1, skipped: 0, durationMs: 42 },
  files: [
    {
      path: 'src/Hero.test.tsx',
      status: 'failed',
      tests: [
        {
          name: 'renders purple',
          fullName: 'Hero renders purple',
          status: 'failed',
          durationMs: 8,
          failureMessages: [
            'AssertionError: expected \'red\' to be \'purple\'\n\nExpected: "purple"\nReceived: "red"',
          ],
          location: { line: 12, column: 3 },
        },
        {
          name: 'is a banner',
          fullName: 'Hero is a banner',
          status: 'passed',
          durationMs: 2,
          failureMessages: [],
        },
      ],
    },
    {
      path: 'src/ok.test.tsx',
      status: 'passed',
      tests: [{ name: 'ok', fullName: 'ok', status: 'passed', durationMs: 1, failureMessages: [] }],
    },
  ],
};

describe('test failure parsing', () => {
  it('reads Expected/Received lines from vitest and jest messages', () => {
    expect(parseExpectedReceived('Expected: "purple"\nReceived: "red"')).toEqual({
      expected: '"purple"',
      received: '"red"',
    });
    expect(
      parseExpectedReceived('- Expected\n+ Received\n\n- \'purple\'\n+ \'red\''),
    ).toEqual({
      expected: "'purple'",
      received: "'red'",
    });
    expect(parseExpectedReceived('boom')).toBeNull();
  });
});

describe('tests panel', () => {
  afterEach(() => {
    uninstallContextCollectors();
    document.querySelector('ai-devtools')?.remove();
    window.localStorage?.removeItem(PREFS_KEY);
    vi.clearAllMocks();
  });

  it('renders a failed test with expected/received and expands it by default', async () => {
    const workspace = createFakeWorkspace({
      onSend(message, emit) {
        if (message.type !== 'test.run') return;
        emit({
          type: 'test.finished',
          status: 'failed',
          summary: FAIL_REPORT.summary,
          report: FAIL_REPORT,
        });
      },
    });
    const host = initDevtools({ workspace });
    const shadow = host?.shadowRoot;
    (shadow?.querySelector('[data-action="tests"]') as HTMLButtonElement).click();
    (shadow?.querySelector('[data-action="run-tests"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(shadow?.querySelector('[data-test-name="renders purple"]')).toBeTruthy());

    const failed = shadow?.querySelector('[data-test-name="renders purple"]') as HTMLElement;
    expect(failed.getAttribute('data-status')).toBe('failed');
    expect(failed.textContent).toContain('Expected');
    expect(failed.textContent).toContain('"purple"');
    expect(failed.textContent).toContain('Received');
    expect(failed.textContent).toContain('"red"');
    expect(failed.querySelector('[aria-expanded="true"]')).toBeTruthy();

    const passedFile = shadow?.querySelector('[data-test-file="src/ok.test.tsx"]') as HTMLElement;
    expect(passedFile.querySelector('[aria-expanded="false"]')).toBeTruthy();
    expect(shadow?.querySelector('[data-test-name="ok"]')).toBeNull();
  });

  it('Fix with AI opens a new chat with the test chip and prompt, without sending', async () => {
    const workspace = createFakeWorkspace({
      onSend(message, emit) {
        if (message.type !== 'test.run') return;
        emit({
          type: 'test.finished',
          status: 'failed',
          summary: FAIL_REPORT.summary,
          report: FAIL_REPORT,
        });
      },
    });
    const host = initDevtools({ workspace });
    const shadow = host?.shadowRoot;
    (shadow?.querySelector('[data-action="tests"]') as HTMLButtonElement).click();
    (shadow?.querySelector('[data-action="run-tests"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(shadow?.querySelector('[data-action="fix-with-ai"]')).toBeTruthy());
    (shadow?.querySelector('[data-action="fix-with-ai"]') as HTMLButtonElement).click();

    const textarea = shadow?.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.value).toBe('Fix this failing test');
    expect(shadow?.querySelector('[data-chip="test"]')?.textContent).toContain('renders purple');
    expect(workspace.sent.some((message) => message.type === 'run.start')).toBe(false);
  });

  it('Re-run failed sends onlyFailed and file run sends file', async () => {
    const workspace = createFakeWorkspace({
      onSend(message, emit) {
        if (message.type !== 'test.run') return;
        emit({
          type: 'test.finished',
          status: 'failed',
          summary: FAIL_REPORT.summary,
          report: FAIL_REPORT,
        });
      },
    });
    const host = initDevtools({ workspace });
    const shadow = host?.shadowRoot;
    (shadow?.querySelector('[data-action="tests"]') as HTMLButtonElement).click();
    (shadow?.querySelector('[data-action="run-tests"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(shadow?.querySelector('[data-action="rerun-failed"]:not([disabled])')).toBeTruthy());

    (shadow?.querySelector('[data-action="rerun-failed"]') as HTMLButtonElement).click();
    const rerun = [...workspace.sent].reverse().find((message) => message.type === 'test.run');
    expect(rerun).toMatchObject({ type: 'test.run', onlyFailed: true });
    expect(rerun && 'file' in rerun ? rerun.file : undefined).toBeUndefined();

    await vi.waitFor(() => expect(shadow?.querySelector('[data-action="run-file"]')).toBeTruthy());
    (shadow?.querySelector('[data-action="run-file"]') as HTMLButtonElement).click();
    const fileRun = [...workspace.sent].reverse().find((message) => message.type === 'test.run');
    expect(fileRun).toMatchObject({ type: 'test.run', file: 'src/Hero.test.tsx' });
  });

  it('auto-runs tests after a files_changed agent run when the pref is on', async () => {
    const workspace = createFakeWorkspace({
      onRequest(message, emit) {
        if (message.type !== 'run.start') return undefined;
        queueMicrotask(() => {
          emit(
            runEvent(message.requestId, 'files_changed', {
              files: ['src/Hero.tsx'],
            }),
          );
          emit(runEvent(message.requestId, 'done'));
        });
        return { type: 'run.accepted', requestId: message.requestId, threadId: 'thr_1', runId: 'run_1' };
      },
      onSend(message, emit) {
        if (message.type !== 'test.run') return;
        emit({
          type: 'test.finished',
          status: 'failed',
          summary: { passed: 0, failed: 3, skipped: 0, durationMs: 18 },
        });
      },
    });
    const host = initDevtools({ workspace });
    const shadow = host?.shadowRoot;
    (shadow?.querySelector('[data-action="tests"]') as HTMLButtonElement).click();
    const toggle = shadow?.querySelector('[data-action="run-tests-after-agent"]') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    toggle.click();
    (shadow?.querySelector('[data-action="chat"]') as HTMLButtonElement).click();
    const textarea = shadow?.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'Make it purple';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    (shadow?.querySelector('[data-action="send"]') as HTMLButtonElement).click();

    await vi.waitFor(() =>
      expect(workspace.sent.some((message) => message.type === 'test.run' && !message.file && !message.onlyFailed)).toBe(
        true,
      ),
    );
    await vi.waitFor(() => expect(shadow?.querySelector('[data-action="run-test-result"]')?.textContent).toBe('Tests: 3 failed'));
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
      id: `evt_${type}`,
      sessionId: 'sess_1',
      type,
      timestamp: 1,
      payload,
    },
  };
}
