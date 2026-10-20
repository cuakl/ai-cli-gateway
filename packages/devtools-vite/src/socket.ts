import {
  FrontendContextPayloadSchema,
  GitCommitRequestSchema,
  ProviderTypeSchema,
  createStreamEvent,
  type GitCommitRequest,
  type GitDiffSummary,
  type UnifiedStreamEvent,
} from '@gateway/shared-types';
import { confineToRoot, PathEscapeError } from '@gateway/core';
import type { ViteDevServer } from 'vite';
import { z } from 'zod';
import type { DevtoolsPromptInput, PromptRunner, PromptSession } from './bridge.js';
import { commit, getDiff, inspectWorkingTree, revert, type GitCommitResult } from './git-service.js';
import { createHmrGuard, type HmrGuard } from './hmr-guard.js';
import { getPtySession, spawnPty, type PtySession, type SpawnPtyOptions } from './pty-service.js';
import { runTests, type TestRunResult } from './test-service.js';

export const PROMPT_EVENT = 'ai-devtools:prompt';
export const CANCEL_EVENT = 'ai-devtools:cancel';
export const STREAM_EVENT = 'ai-devtools:stream-event';
export const GIT_DIFF_EVENT = 'ai-devtools:git-diff';
export const GIT_COMMIT_EVENT = 'ai-devtools:git-commit';
export const GIT_REVERT_EVENT = 'ai-devtools:git-revert';
export const PTY_SPAWN_EVENT = 'ai-devtools:pty-spawn';
export const PTY_INPUT_EVENT = 'ai-devtools:pty-input';
export const PTY_RESIZE_EVENT = 'ai-devtools:pty-resize';
export const PTY_DISPOSE_EVENT = 'ai-devtools:pty-dispose';
export const PTY_DATA_EVENT = 'ai-devtools:pty-data';
export const PTY_EXIT_EVENT = 'ai-devtools:pty-exit';
export const RUN_TESTS_EVENT = 'ai-devtools:run-tests';
export const TEST_OUTPUT_EVENT = 'ai-devtools:test-output';
export const TEST_DONE_EVENT = 'ai-devtools:test-done';

const PromptPayloadSchema = z.object({
  provider: ProviderTypeSchema,
  prompt: z.string().min(1),
  cwd: z.string().min(1).optional(),
  files: z.array(z.string()).optional(),
  context: FrontendContextPayloadSchema.optional(),
  yolo: z.boolean().optional(),
  ephemeral: z.boolean().optional(),
  sessionId: z.string().min(1).optional(),
});

const CancelPayloadSchema = z.object({
  sessionId: z.string().min(1).optional(),
});

const RequestSchema = z.object({
  requestId: z.string().min(1).optional(),
});

const GitCommitPayloadSchema = GitCommitRequestSchema.extend({
  requestId: z.string().min(1).optional(),
});

const GitRevertPayloadSchema = RequestSchema.extend({
  files: z.array(z.string().min(1)).optional(),
});

const PtySpawnPayloadSchema = RequestSchema.extend({
  cols: z.number().int().positive().max(500).optional(),
  rows: z.number().int().positive().max(200).optional(),
});

const PtyInputPayloadSchema = z.object({
  sessionId: z.string().min(1),
  data: z.string().max(200_000),
});

const PtyResizePayloadSchema = z.object({
  sessionId: z.string().min(1),
  cols: z.number().int().positive().max(500),
  rows: z.number().int().positive().max(200),
});

const PtyDisposePayloadSchema = z.object({
  sessionId: z.string().min(1),
});

export interface DevtoolsServices {
  getDiff(rootDir: string): Promise<GitDiffSummary>;
  commit(rootDir: string, request: GitCommitRequest): Promise<GitCommitResult>;
  revert(rootDir: string, files?: string[]): Promise<void>;
  spawnPty(options: SpawnPtyOptions): Promise<PtySession>;
  getPty(id: string): PtySession | undefined;
  runTests(rootDir: string, onLine: (line: string) => void, signal?: AbortSignal): Promise<TestRunResult>;
}

interface StreamClient {
  send(event: string, data?: unknown): void;
  socket?: {
    once(event: 'close', listener: () => void): void;
  };
}

/**
 * Bridge overlay prompts, git, PTY, and test runs on Vite's HMR socket.
 * Stream events go back as `ai-devtools:stream-event`.
 */
export function registerDevtoolsSocket(
  server: ViteDevServer,
  runner: PromptRunner,
  cwd: string,
  services: DevtoolsServices = createDevtoolsServices(),
): void {
  const sessions = new WeakMap<StreamClient, Map<string, PromptSession>>();
  const ptySessions = new WeakMap<StreamClient, Set<string>>();
  const testRuns = new WeakMap<StreamClient, AbortController>();
  const hmr = createHmrGuard(server.ws);
  const reloadHolds = new Map<string, () => void>();

  server.ws.on(PROMPT_EVENT, (data: unknown, client: StreamClient) => {
    return handlePrompt(data, client).catch((error: unknown) => {
      server.config.logger.error(error instanceof Error ? error.message : 'AI DevTools prompt failed');
    });
  });

  server.ws.on(CANCEL_EVENT, (data: unknown, client: StreamClient) => {
    return cancelPrompt(sessions, reloadHolds, client, data).catch((error: unknown) => {
      server.config.logger.error(error instanceof Error ? error.message : 'AI DevTools cancel failed');
    });
  });

  server.ws.on(GIT_DIFF_EVENT, (data: unknown, client: StreamClient) => {
    return handleGitDiff(data, client);
  });

  server.ws.on(GIT_COMMIT_EVENT, (data: unknown, client: StreamClient) => {
    return handleGitCommit(data, client);
  });

  server.ws.on(GIT_REVERT_EVENT, (data: unknown, client: StreamClient) => {
    return handleGitRevert(data, client);
  });

  server.ws.on(PTY_SPAWN_EVENT, (data: unknown, client: StreamClient) => {
    return handlePtySpawn(data, client);
  });

  server.ws.on(PTY_INPUT_EVENT, (data: unknown, client: StreamClient) => {
    const parsed = PtyInputPayloadSchema.safeParse(data);
    if (!parsed.success) return;
    const session = ptySessions.get(client)?.has(parsed.data.sessionId)
      ? services.getPty(parsed.data.sessionId)
      : undefined;
    session?.write(parsed.data.data);
  });

  server.ws.on(PTY_RESIZE_EVENT, (data: unknown, client: StreamClient) => {
    const parsed = PtyResizePayloadSchema.safeParse(data);
    if (!parsed.success) return;
    if (!ptySessions.get(client)?.has(parsed.data.sessionId)) return;
    services.getPty(parsed.data.sessionId)?.resize(parsed.data.cols, parsed.data.rows);
  });

  server.ws.on(PTY_DISPOSE_EVENT, (data: unknown, client: StreamClient) => {
    const parsed = PtyDisposePayloadSchema.safeParse(data);
    if (!parsed.success) return;
    disposePty(client, parsed.data.sessionId);
  });

  server.ws.on(RUN_TESTS_EVENT, (data: unknown, client: StreamClient) => {
    return handleRunTests(data, client);
  });

  async function handleGitDiff(data: unknown, client: StreamClient): Promise<void> {
    const parsed = RequestSchema.safeParse(data ?? {});
    const requestId = parsed.success ? parsed.data.requestId : undefined;
    if (!parsed.success) {
      reply(client, GIT_DIFF_EVENT, requestId, { ok: false, error: issueMessage(parsed.error) });
      return;
    }
    try {
      const diff = await services.getDiff(cwd);
      reply(client, GIT_DIFF_EVENT, requestId, { ok: true, diff });
    } catch (error) {
      reply(client, GIT_DIFF_EVENT, requestId, { ok: false, error: errorMessage(error) });
    }
  }

  async function handleGitCommit(data: unknown, client: StreamClient): Promise<void> {
    const parsed = GitCommitPayloadSchema.safeParse(data);
    const requestId = parsed.success ? parsed.data.requestId : requestIdOf(data);
    if (!parsed.success) {
      reply(client, GIT_COMMIT_EVENT, requestId, { ok: false, error: issueMessage(parsed.error) });
      return;
    }
    try {
      const result = await services.commit(cwd, {
        message: parsed.data.message,
        ...(parsed.data.files !== undefined ? { files: parsed.data.files } : {}),
        ...(parsed.data.push !== undefined ? { push: parsed.data.push } : {}),
      });
      reply(client, GIT_COMMIT_EVENT, requestId, { ok: true, ...result });
    } catch (error) {
      reply(client, GIT_COMMIT_EVENT, requestId, { ok: false, error: errorMessage(error) });
    }
  }

  async function handleGitRevert(data: unknown, client: StreamClient): Promise<void> {
    const parsed = GitRevertPayloadSchema.safeParse(data ?? {});
    const requestId = parsed.success ? parsed.data.requestId : requestIdOf(data);
    if (!parsed.success) {
      reply(client, GIT_REVERT_EVENT, requestId, { ok: false, error: issueMessage(parsed.error) });
      return;
    }
    try {
      await services.revert(cwd, parsed.data.files);
      reply(client, GIT_REVERT_EVENT, requestId, { ok: true });
    } catch (error) {
      reply(client, GIT_REVERT_EVENT, requestId, { ok: false, error: errorMessage(error) });
    }
  }

  async function handlePtySpawn(data: unknown, client: StreamClient): Promise<void> {
    const parsed = PtySpawnPayloadSchema.safeParse(data ?? {});
    const requestId = parsed.success ? parsed.data.requestId : requestIdOf(data);
    if (!parsed.success) {
      reply(client, PTY_SPAWN_EVENT, requestId, { ok: false, error: issueMessage(parsed.error) });
      return;
    }
    try {
      let sessionId = '';
      const pending: string[] = [];
      let pendingExit: number | null = null;
      const session = await services.spawnPty({
        cwd,
        ...(parsed.data.cols !== undefined ? { cols: parsed.data.cols } : {}),
        ...(parsed.data.rows !== undefined ? { rows: parsed.data.rows } : {}),
        onData(chunk) {
          if (!sessionId) pending.push(chunk);
          else client.send(PTY_DATA_EVENT, { sessionId, data: chunk });
        },
        onExit(code) {
          if (!sessionId) {
            pendingExit = code;
            return;
          }
          disposePty(client, sessionId);
          client.send(PTY_EXIT_EVENT, { sessionId, code });
        },
      });
      sessionId = session.id;
      trackPty(client, session.id);
      for (const chunk of pending.splice(0)) {
        client.send(PTY_DATA_EVENT, { sessionId, data: chunk });
      }
      reply(client, PTY_SPAWN_EVENT, requestId, {
        ok: true,
        sessionId: session.id,
        fallback: session.fallback,
      });
      if (pendingExit !== null) {
        disposePty(client, session.id);
        client.send(PTY_EXIT_EVENT, { sessionId, code: pendingExit });
      }
    } catch (error) {
      reply(client, PTY_SPAWN_EVENT, requestId, { ok: false, error: errorMessage(error) });
    }
  }

  async function handleRunTests(data: unknown, client: StreamClient): Promise<void> {
    const parsed = RequestSchema.safeParse(data ?? {});
    const requestId = parsed.success ? parsed.data.requestId : requestIdOf(data);
    if (!parsed.success) {
      reply(client, TEST_DONE_EVENT, requestId, { ok: false, error: issueMessage(parsed.error) });
      return;
    }
    testRuns.get(client)?.abort();
    const controller = new AbortController();
    testRuns.set(client, controller);
    client.socket?.once('close', () => controller.abort());
    try {
      const result = await services.runTests(
        cwd,
        (line) => {
          if (controller.signal.aborted) return;
          client.send(TEST_OUTPUT_EVENT, { ...(requestId ? { requestId } : {}), line });
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      reply(client, TEST_DONE_EVENT, requestId, { ok: true, exitCode: result.exitCode, command: result.command });
    } catch (error) {
      if (controller.signal.aborted) return;
      reply(client, TEST_DONE_EVENT, requestId, { ok: false, error: errorMessage(error) });
    } finally {
      if (testRuns.get(client) === controller) testRuns.delete(client);
    }
  }

  function trackPty(client: StreamClient, sessionId: string): void {
    let owned = ptySessions.get(client);
    if (!owned) {
      owned = new Set();
      ptySessions.set(client, owned);
      const ownedSet = owned;
      client.socket?.once('close', () => {
        for (const id of [...ownedSet]) disposePty(client, id);
      });
    }
    owned.add(sessionId);
  }

  function disposePty(client: StreamClient, sessionId: string): void {
    ptySessions.get(client)?.delete(sessionId);
    services.getPty(sessionId)?.dispose();
  }

  async function handlePrompt(data: unknown, client: StreamClient): Promise<void> {
    const parsed = PromptPayloadSchema.safeParse(data);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const message = issue ? `${issue.path.join('.') || 'message'}: ${issue.message}` : 'Invalid prompt';
      emitTerminal(client, 'invalid', message);
      return;
    }

    const requestedCwd = parsed.data.cwd ?? cwd;
    let safeCwd = requestedCwd;
    let safeFiles = parsed.data.files;
    try {
      safeCwd = await confineToRoot(cwd, requestedCwd);
      if (parsed.data.files) {
        safeFiles = [];
        for (const file of parsed.data.files) {
          safeFiles.push(await confineToRoot(cwd, file, safeCwd));
        }
      }
    } catch (error) {
      const message = error instanceof PathEscapeError ? error.message : errorMessage(error);
      emitTerminal(client, parsed.data.sessionId ?? 'invalid', message);
      return;
    }

    const input: DevtoolsPromptInput = {
      provider: parsed.data.provider,
      prompt: parsed.data.prompt,
      cwd: safeCwd,
      ...(safeFiles !== undefined ? { files: safeFiles } : {}),
      ...(parsed.data.context !== undefined ? { context: parsed.data.context } : {}),
      ...(parsed.data.yolo !== undefined ? { yolo: parsed.data.yolo } : {}),
      ...(parsed.data.ephemeral !== undefined ? { ephemeral: parsed.data.ephemeral } : {}),
      ...(parsed.data.sessionId !== undefined ? { sessionId: parsed.data.sessionId } : {}),
    };

    const report = await inspectWorkingTree(safeCwd);
    if (report.warning) {
      sendEvent(
        client,
        createStreamEvent(parsed.data.sessionId ?? 'workspace', 'chunk', { text: report.warning }),
      );
    }

    const tracked: { session?: PromptSession } = {};
    let finished = false;
    const release = holdReloads(hmr);
    let session: PromptSession;
    try {
      session = await runner.start(input, (event) => {
        sendEvent(client, event);
        if (event.type !== 'done') return;
        finished = true;
        const current = tracked.session;
        if (current) reloadHolds.delete(current.sessionId);
        release();
        if (!current) return;
        sessions.get(client)?.delete(current.sessionId);
      });
    } catch (error) {
      release();
      throw error;
    }
    tracked.session = session;
    if (finished) return;

    let map = sessions.get(client);
    if (!map) {
      map = new Map();
      sessions.set(client, map);
    }
    map.set(session.sessionId, session);
    reloadHolds.set(session.sessionId, release);
    client.socket?.once('close', () => {
      release();
      const current = sessions.get(client)?.get(session.sessionId);
      if (!current) return;
      sessions.get(client)?.delete(session.sessionId);
      void current.cancel();
    });
  }
}

function holdReloads(hmr: HmrGuard): () => void {
  hmr.begin();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    hmr.end();
  };
}

export function createDevtoolsServices(): DevtoolsServices {
  return {
    getDiff,
    commit,
    revert,
    spawnPty,
    getPty: getPtySession,
    runTests,
  };
}

async function cancelPrompt(
  sessions: WeakMap<StreamClient, Map<string, PromptSession>>,
  reloadHolds: Map<string, () => void>,
  client: StreamClient,
  data: unknown,
): Promise<void> {
  const map = sessions.get(client);
  if (!map || map.size === 0) return;
  const parsed = CancelPayloadSchema.safeParse(data ?? {});
  const requested = parsed.success ? parsed.data.sessionId : undefined;
  const targets = requested ? compact([map.get(requested)]) : [...map.values()].slice(-1);
  for (const session of targets) {
    map.delete(session.sessionId);
    reloadHolds.get(session.sessionId)?.();
    reloadHolds.delete(session.sessionId);
    await session.cancel();
  }
}

function emitTerminal(client: StreamClient, sessionId: string, message: string): void {
  sendEvent(client, createStreamEvent(sessionId, 'error', { error: message }));
  sendEvent(client, createStreamEvent(sessionId, 'done', {}));
}

function sendEvent(client: StreamClient, event: UnifiedStreamEvent): void {
  client.send(STREAM_EVENT, { event });
}

function reply(
  client: StreamClient,
  event: string,
  requestId: string | undefined,
  body: Record<string, unknown>,
): void {
  client.send(event, {
    ...(requestId ? { requestId } : {}),
    ...body,
  });
}

function requestIdOf(data: unknown): string | undefined {
  if (!data || typeof data !== 'object' || !('requestId' in data)) return undefined;
  const value = (data as { requestId?: unknown }).requestId;
  return typeof value === 'string' && value ? value : undefined;
}

function issueMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Invalid request';
  const pathName = issue.path.join('.');
  return pathName ? `${pathName}: ${issue.message}` : issue.message;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed';
}

function compact<T>(values: Array<T | undefined>): T[] {
  return values.filter((value): value is T => value !== undefined);
}
