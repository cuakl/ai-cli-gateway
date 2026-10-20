import type { ViteDevServer } from 'vite';
import { describe, expect, it, vi } from 'vitest';
import type { GitCommitRequest, GitDiffSummary } from '@gateway/shared-types';
import type { PtySession } from '../src/pty-service.js';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import {
  GIT_COMMIT_EVENT,
  GIT_DIFF_EVENT,
  GIT_REVERT_EVENT,
  PROMPT_EVENT,
  RUN_TESTS_EVENT,
  STREAM_EVENT,
  TEST_DONE_EVENT,
  TEST_OUTPUT_EVENT,
  registerDevtoolsSocket,
  type DevtoolsServices,
} from '../src/socket.js';
import type { PromptRunner } from '../src/bridge.js';

const diff: GitDiffSummary = {
  branch: 'main',
  files: [
    {
      path: 'src/App.tsx',
      status: 'modified',
      additions: 1,
      deletions: 0,
      hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, content: ' keep\n+add' }],
    },
  ],
  insertions: 1,
  deletions: 0,
};

describe('devtools socket services', () => {
  it('routes git diff, commit, and revert messages', async () => {
    const commits: GitCommitRequest[] = [];
    const reverted: Array<string[] | undefined> = [];
    const { listeners, sent } = bind({
      async getDiff() {
        return diff;
      },
      async commit(_root, request) {
        commits.push(request);
        return { commitHash: 'abc1234', branch: 'main' };
      },
      async revert(_root, files) {
        reverted.push(files);
      },
    });
    const client = recorder(sent);

    await listeners.get(GIT_DIFF_EVENT)?.({ requestId: 'diff-1' }, client);
    await listeners.get(GIT_COMMIT_EVENT)?.(
      { requestId: 'commit-1', message: 'feat: button', files: ['src/App.tsx'], push: true },
      client,
    );
    await listeners.get(GIT_REVERT_EVENT)?.({ requestId: 'revert-1', files: ['src/App.tsx'] }, client);
    await listeners.get(GIT_COMMIT_EVENT)?.({ requestId: 'commit-bad' }, client);

    expect(sent).toEqual([
      { event: GIT_DIFF_EVENT, data: { requestId: 'diff-1', ok: true, diff } },
      {
        event: GIT_COMMIT_EVENT,
        data: { requestId: 'commit-1', ok: true, commitHash: 'abc1234', branch: 'main' },
      },
      { event: GIT_REVERT_EVENT, data: { requestId: 'revert-1', ok: true } },
      {
        event: GIT_COMMIT_EVENT,
        data: { requestId: 'commit-bad', ok: false, error: expect.stringContaining('message') },
      },
    ]);
    expect(commits).toEqual([{ message: 'feat: button', files: ['src/App.tsx'], push: true }]);
    expect(reverted).toEqual([['src/App.tsx']]);
  });

  it('rejects a prompt cwd outside the project and warns when the tree is dirty', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ai-devtools-prompt-'));
    try {
      const git = simpleGit(dir);
      await git.init(['-b', 'main']);
      await git.addConfig('user.name', 'DevTools Test');
      await git.addConfig('user.email', 'devtools@example.com');
      await writeFile(path.join(dir, 'app.txt'), 'hello\n');
      await git.add('.');
      await git.commit('init');
      await writeFile(path.join(dir, 'app.txt'), 'hello\ndirty\n');

      const seen: string[] = [];
      const sent: Array<{ event: string; data: unknown }> = [];
      const listeners = new Map<string, (data: unknown, client: Client) => Promise<void> | void>();
      registerDevtoolsSocket(
        {
          config: { root: dir, logger: { error: vi.fn(), warn: vi.fn() } },
          ws: {
            on(event: string, listener: (data: unknown, client: Client) => Promise<void> | void) {
              listeners.set(event, listener);
            },
          },
        } as unknown as ViteDevServer,
        {
          async start(input) {
            seen.push(input.cwd);
            return { sessionId: 'sess_dirty', async cancel() {} };
          },
        },
        dir,
      );
      const client = recorder(sent);
      await listeners.get(PROMPT_EVENT)?.({ provider: 'cursor', prompt: 'edit', cwd: '/etc' }, client);
      await listeners.get(PROMPT_EVENT)?.({ provider: 'cursor', prompt: 'edit' }, client);

      expect(seen).toEqual([await realpath(dir)]);
      expect(sent[0]).toMatchObject({
        event: STREAM_EVENT,
        data: { event: { type: 'error', payload: { error: expect.stringContaining('escapes the project root') } } },
      });
      expect(sent[1]).toMatchObject({ event: STREAM_EVENT, data: { event: { type: 'done' } } });
      expect(sent[2]).toMatchObject({
        event: STREAM_EVENT,
        data: { event: { type: 'chunk', payload: { text: expect.stringContaining('uncommitted changes') } } },
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('streams test output and returns the exit code', async () => {
    const { listeners, sent } = bind({
      async runTests(_root, onLine) {
        onLine('PASS src/App.test.ts');
        onLine('FAIL src/Hero.test.ts');
        return { exitCode: 1, command: 'pnpm test' };
      },
    });
    const client = recorder(sent);
    await listeners.get(RUN_TESTS_EVENT)?.({ requestId: 'tests-1' }, client);
    expect(sent).toEqual([
      { event: TEST_OUTPUT_EVENT, data: { requestId: 'tests-1', line: 'PASS src/App.test.ts' } },
      { event: TEST_OUTPUT_EVENT, data: { requestId: 'tests-1', line: 'FAIL src/Hero.test.ts' } },
      { event: TEST_DONE_EVENT, data: { requestId: 'tests-1', ok: true, exitCode: 1, command: 'pnpm test' } },
    ]);
  });
});

function bind(overrides: Partial<DevtoolsServices>): {
  listeners: Map<string, (data: unknown, client: Client) => Promise<void> | void>;
  sent: Array<{ event: string; data: unknown }>;
} {
  const listeners = new Map<string, (data: unknown, client: Client) => Promise<void> | void>();
  const sent: Array<{ event: string; data: unknown }> = [];
  const services: DevtoolsServices = {
    async getDiff() {
      throw new Error('not stubbed');
    },
    async commit() {
      throw new Error('not stubbed');
    },
    async revert() {
      throw new Error('not stubbed');
    },
    async spawnPty() {
      return fakePty();
    },
    getPty() {
      return undefined;
    },
    async runTests() {
      return { exitCode: 0, command: 'pnpm test' };
    },
    ...overrides,
  };
  const runner: PromptRunner = {
    async start() {
      return { sessionId: 'unused', async cancel() {} };
    },
  };
  registerDevtoolsSocket(
    {
      config: { root: '/proj', logger: { error: vi.fn(), warn: vi.fn() } },
      ws: {
        on(event: string, listener: (data: unknown, client: Client) => Promise<void> | void) {
          listeners.set(event, listener);
        },
      },
    } as unknown as ViteDevServer,
    runner,
    '/proj',
    services,
  );
  return { listeners, sent };
}

function recorder(sent: Array<{ event: string; data: unknown }>): Client {
  return {
    send(event, data) {
      sent.push({ event, data });
    },
  };
}

function fakePty(): PtySession {
  return {
    id: 'pty_test',
    fallback: false,
    write() {},
    resize() {},
    dispose() {},
  };
}

interface Client {
  send(event: string, data?: unknown): void;
}
