import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { PathEscapeError, confineToRoot, isInsideRoot, logger } from '@aidev/adapters';
import {
  WorkspaceClientMessageSchema,
  WorkspaceServerMessageSchema,
  createStreamEvent,
  type ContextSummary,
  type FrontendContextPayload,
  type Thread,
  type UnifiedStreamEvent,
  type WorkspaceClientMessage,
  type WorkspaceServerMessage,
} from '@aidev/protocol';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { ptyPermitted, requirePrincipal, type Principal } from '../auth/principal.js';
import { HttpError } from '../errors.js';
import { abortThreadRun, cancelSession, executionHttpError, startExecution } from '../execute.js';
import { composePrompt } from '../prompt-context.js';
import { deleteThreadFully } from '../threads/control.js';
import { providerSupportsResume } from '../threads/resume.js';
import { runningRun, threadTitle, type ThreadRunBinding } from '../threads/run.js';
import { ThreadStoreError } from '../threads/store.js';
import { loadPreviousConversation } from '../threads/transcript.js';
import type { ServerDeps } from '../types.js';
import { commit, getDiff, gitLog, gitStatus, inspectWorkingTree, revert } from '../workspace/git-service.js';
import { spawnPty, type PtySession } from '../workspace/pty-service.js';
import { runTests } from '../workspace/test-service.js';

const WS_OPEN = 1;

const NOT_IMPLEMENTED = new Set<WorkspaceClientMessage['type']>([
  'git.checkpoint.restore',
  'git.branch.create',
  'git.pr.create',
  'commit.suggest',
]);

interface TrackedRun {
  runId: string;
  sessionId: string;
  projectId: string;
}

interface LivePty {
  projectId: string;
  session: PtySession;
}

/**
 * Multiplexed project socket: agent runs, threads, git, PTY, and tests.
 * Checkpoints, branches, and commit suggestions reply `not_implemented`.
 */
export function registerWorkspaceRoutes(app: FastifyInstance, deps: ServerDeps): void {
  const hubs = new Map<string, Set<WebSocket>>();
  const runs = new Map<string, TrackedRun>();
  const ptys = new Map<string, LivePty>();
  const tests = new Map<string, AbortController>();

  const broadcast = (projectId: string, message: WorkspaceServerMessage): void => {
    const sockets = hubs.get(projectId);
    if (!sockets) return;
    const payload = encode(message);
    if (!payload) return;
    for (const socket of sockets) write(socket, payload);
  };

  const activity = (projectId: string): void => {
    const project = deps.projects.get(projectId);
    if (!project) return;
    const activeRuns = deps.registry.list().filter((record) => {
      if (record.status !== 'running' && record.status !== 'pending') return false;
      return isInsideRoot(project.root, record.cwd);
    }).length;
    broadcast(projectId, { type: 'project.activity', activeRuns });
  };

  app.get('/api/v1/projects/:projectId/ws', { websocket: true }, (socket: WebSocket, request) => {
    const params = request.params as { projectId?: string };
    const projectId = params.projectId ?? '';
    const lookedUp = deps.projects.get(projectId);
    let principal: Principal;
    try {
      principal = requirePrincipal(request);
    } catch {
      socket.close(4401, 'unauthorized');
      return;
    }
    if (!lookedUp) {
      socket.close(4403, 'forbidden');
      return;
    }
    if (principal.kind === 'browser' && principal.projectId !== projectId) {
      socket.close(4403, 'forbidden');
      return;
    }
    const project = lookedUp;

    let peers = hubs.get(projectId);
    if (!peers) {
      peers = new Set();
      hubs.set(projectId, peers);
    }
    peers.add(socket);
    activity(projectId);

    const reply = (message: WorkspaceServerMessage): void => {
      const payload = encode(message);
      if (payload) write(socket, payload);
    };

    socket.on('close', () => {
      peers?.delete(socket);
      if (peers && peers.size === 0) hubs.delete(projectId);
    });
    socket.on('error', () => {
      // `close` drops the socket from the hub.
    });
    socket.on('message', (data: unknown) => {
      void handleMessage(messageText(data)).catch((error: unknown) => {
        logger.error(error instanceof Error ? error.message : 'workspace message failed');
        reply({ type: 'error', code: 'internal', message: 'Message handling failed' });
      });
    });

    async function handleMessage(text: string): Promise<void> {
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        reply({ type: 'error', code: 'invalid_json', message: 'Invalid JSON message' });
        return;
      }
      const requestId = requestIdOf(payload);
      const parsed = WorkspaceClientMessageSchema.safeParse(payload);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const message = issue ? `${issue.path.join('.') || 'message'}: ${issue.message}` : 'Invalid message';
        reply({ type: 'error', ...(requestId ? { requestId } : {}), code: 'validation_error', message });
        return;
      }
      const message = parsed.data;
      if (NOT_IMPLEMENTED.has(message.type)) {
        reply({
          type: 'error',
          ...(message.requestId ? { requestId: message.requestId } : {}),
          code: 'not_implemented',
          message: `${message.type} is not available yet`,
        });
        return;
      }
      try {
        await dispatch(message);
      } catch (error) {
        const failure = asFailure(error);
        reply({
          type: 'error',
          ...(message.requestId ? { requestId: message.requestId } : {}),
          code: failure.code,
          message: failure.message,
        });
      }
    }

    async function dispatch(message: WorkspaceClientMessage): Promise<void> {
      switch (message.type) {
        case 'run.start':
          await startRun(message);
          return;
        case 'run.cancel':
          await cancelRun(message);
          return;
        case 'thread.list': {
          const threads = await deps.threads.listThreads({ projectId });
          reply({
            type: 'thread.list.result',
            ...(message.requestId ? { requestId: message.requestId } : {}),
            threads,
          });
          return;
        }
        case 'thread.get': {
          const record = await deps.threads.getThread(message.threadId);
          if (!record || record.thread.projectId !== projectId) {
            throw new HttpError(404, 'not_found', `Thread ${message.threadId} was not found`);
          }
          const events = await deps.threads.readEvents(message.threadId);
          reply({
            type: 'thread.get.result',
            ...(message.requestId ? { requestId: message.requestId } : {}),
            thread: record.thread,
            runs: record.runs,
            events,
          });
          return;
        }
        case 'thread.delete': {
          const record = await deps.threads.getThread(message.threadId);
          if (!record || record.thread.projectId !== projectId) {
            throw new HttpError(404, 'not_found', `Thread ${message.threadId} was not found`);
          }
          await deleteThreadFully(deps, message.threadId);
          reply({
            type: 'thread.delete.result',
            ...(message.requestId ? { requestId: message.requestId } : {}),
            threadId: message.threadId,
          });
          return;
        }
        case 'thread.keep': {
          const record = await deps.threads.getThread(message.threadId);
          if (!record || record.thread.projectId !== projectId) {
            throw new HttpError(404, 'not_found', `Thread ${message.threadId} was not found`);
          }
          const thread = await deps.threads.updateThread(message.threadId, { keep: message.keep });
          reply({
            type: 'thread.keep.result',
            ...(message.requestId ? { requestId: message.requestId } : {}),
            thread,
          });
          return;
        }
        case 'git.status': {
          const status = await gitStatus(project.root);
          reply({
            type: 'git.status.result',
            ...(message.requestId ? { requestId: message.requestId } : {}),
            status,
          });
          return;
        }
        case 'git.diff': {
          const summary = await getDiff(project.root, message.paths);
          reply({
            type: 'git.diff.result',
            ...(message.requestId ? { requestId: message.requestId } : {}),
            summary,
          });
          return;
        }
        case 'git.commit': {
          const created = await commit(project.root, {
            message: message.message,
            files: message.paths,
            push: message.push,
          });
          reply({
            type: 'git.commit.result',
            ...(message.requestId ? { requestId: message.requestId } : {}),
            commitHash: created.commitHash,
            branch: created.branch,
            pushed: message.push,
          });
          broadcast(projectId, { type: 'git.changed', summary: await getDiff(project.root) });
          return;
        }
        case 'git.discard': {
          const paths = await revert(project.root, message.paths);
          reply({
            type: 'git.discard.result',
            ...(message.requestId ? { requestId: message.requestId } : {}),
            paths,
          });
          broadcast(projectId, { type: 'git.changed', summary: await getDiff(project.root) });
          return;
        }
        case 'git.log': {
          const commits = await gitLog(project.root, message.limit);
          reply({
            type: 'git.log.result',
            ...(message.requestId ? { requestId: message.requestId } : {}),
            commits,
          });
          return;
        }
        case 'pty.spawn':
          await spawnShell(message);
          return;
        case 'pty.input': {
          const live = ptyFor(message.sessionId);
          live.session.write(message.data);
          return;
        }
        case 'pty.resize': {
          const live = ptyFor(message.sessionId);
          live.session.resize(message.cols, message.rows);
          return;
        }
        case 'pty.dispose': {
          const live = ptys.get(message.sessionId);
          if (!live || live.projectId !== projectId) {
            throw new HttpError(404, 'not_found', `PTY ${message.sessionId} was not found`);
          }
          live.session.dispose();
          ptys.delete(message.sessionId);
          return;
        }
        case 'test.run':
          await startTests(message);
          return;
        case 'test.stop':
          stopTests();
          return;
        default:
          return;
      }
    }

    async function startRun(message: Extract<WorkspaceClientMessage, { type: 'run.start' }>): Promise<void> {
      let warning: string | undefined;
      if (message.mode === 'agent') {
        const report = await inspectWorkingTree(project.root);
        if (report.conflicted.length > 0) {
          reply({
            type: 'error',
            ...(message.requestId ? { requestId: message.requestId } : {}),
            code: 'conflicted',
            message: report.warning ?? 'The working tree has unresolved conflicts',
          });
          return;
        }
        warning = report.warning;
      }

      const thread = await openThread(deps, projectId, message);
      const runRecord = runningRun({
        threadId: thread.id,
        prompt: message.prompt,
        contextSummary: summarizeContext(message.context),
        attachments: message.attachments,
      });
      await deps.threads.updateRun(thread.id, runRecord);
      const binding: ThreadRunBinding = {
        threadId: thread.id,
        runId: runRecord.id,
        prompt: message.prompt,
        startedAt: runRecord.startedAt,
        contextSummary: runRecord.contextSummary,
        attachments: runRecord.attachments,
      };
      const sessionId = `sess_${randomUUID()}`;
      const prelude = warning
        ? [createStreamEvent(sessionId, 'chunk', { text: warning, segment: -1 })]
        : undefined;
      const resume = await resumeSessionId(deps, thread, message.provider);
      let prompt = composePrompt(message.prompt, message.context);
      if (!resume) {
        const prior = await loadPreviousConversation(deps.threads, thread.id, runRecord.id);
        if (prior) prompt = `${prior}\n\n${prompt}`;
      }

      let started: Awaited<ReturnType<typeof startExecution>>;
      try {
        started = await startExecution(
          deps,
          {
            provider: message.provider,
            cwd: project.root,
            prompt,
            yolo: message.mode === 'agent',
            sessionId,
            mode: message.mode,
            ...(message.model ? { model: message.model } : {}),
            ...(resume ? { providerSessionId: resume } : {}),
          },
          sessionId,
          principal,
          { binding, ...(prelude ? { prelude } : {}) },
        );
      } catch (error) {
        await abortThreadRun(deps, binding, error);
        const httpError = error instanceof HttpError ? error : executionHttpError(error);
        reply({
          type: 'error',
          ...(message.requestId ? { requestId: message.requestId } : {}),
          code: httpError.code,
          message: httpError.message,
        });
        return;
      }

      const runId = binding.runId;
      runs.set(runId, { runId, sessionId, projectId });
      reply({
        type: 'run.accepted',
        ...(message.requestId ? { requestId: message.requestId } : {}),
        threadId: thread.id,
        runId,
      });
      activity(projectId);

      let live = false;
      const queued: UnifiedStreamEvent[] = [];
      const sendEvent = (event: UnifiedStreamEvent): void => {
        reply({
          type: 'run.event',
          ...(message.requestId ? { requestId: message.requestId } : {}),
          runId,
          event,
        });
      };
      const subscription = deps.registry.subscribe(sessionId, (event) => {
        if (live) sendEvent(event);
        else queued.push(event);
      });
      if (prelude) {
        for (const event of prelude) sendEvent(event);
      }
      const buffered = (subscription?.events ?? []).concat(queued.splice(0, queued.length));
      live = true;
      for (const event of buffered) sendEvent(event);

      const outcome = await started.done;
      if (!live) return;
      if (!outcome.run) throw new HttpError(500, 'thread_store', 'Run record was not saved');
      reply({
        type: 'run.finished',
        ...(message.requestId ? { requestId: message.requestId } : {}),
        run: outcome.run,
      });
      runs.delete(runId);
      if (outcome.events.some((event) => event.type === 'file_edit')) {
        try {
          broadcast(projectId, { type: 'git.changed', summary: await getDiff(project.root) });
        } catch (error) {
          logger.error(error instanceof Error ? error.message : 'git.changed failed');
        }
      }
      activity(projectId);
    }

    async function cancelRun(message: Extract<WorkspaceClientMessage, { type: 'run.cancel' }>): Promise<void> {
      const tracked = runs.get(message.runId);
      if (!tracked || tracked.projectId !== projectId) {
        throw new HttpError(404, 'not_found', `Run ${message.runId} was not found`);
      }
      await cancelSession(deps.registry, tracked.sessionId);
    }

    async function spawnShell(message: Extract<WorkspaceClientMessage, { type: 'pty.spawn' }>): Promise<void> {
      if (!ptyPermitted(principal, deps.bindHost)) {
        throw new HttpError(403, 'pty_forbidden', 'PTY is disabled unless the gateway is on loopback or the project allows a remote shell');
      }
      const session = await spawnPty({
        cwd: project.root,
        cols: message.cols,
        rows: message.rows,
        onData(data) {
          broadcast(projectId, { type: 'pty.data', sessionId: session.id, data });
        },
        onExit(code) {
          ptys.delete(session.id);
          broadcast(projectId, { type: 'pty.exit', sessionId: session.id, code });
        },
      });
      ptys.set(session.id, { projectId, session });
      reply({
        type: 'pty.spawn.result',
        ...(message.requestId ? { requestId: message.requestId } : {}),
        sessionId: session.id,
        fallback: session.fallback,
      });
    }

    function ptyFor(sessionId: string): LivePty {
      const known = ptys.get(sessionId);
      if (!known || known.projectId !== projectId) {
        throw new HttpError(404, 'not_found', `PTY ${sessionId} was not found`);
      }
      return known;
    }

    async function startTests(message: Extract<WorkspaceClientMessage, { type: 'test.run' }>): Promise<void> {
      if (tests.has(projectId)) {
        throw new HttpError(409, 'test_running', 'A test run is already in progress');
      }
      let file: string | undefined;
      if (message.file) {
        const absolute = await confineToRoot(project.root, message.file, project.root);
        file = path.relative(project.root, absolute).split(path.sep).join('/');
      }
      const controller = new AbortController();
      tests.set(projectId, controller);
      const startedAt = Date.now();
      const requestId = message.requestId;
      try {
        const result = await runTests(
          project.root,
          (line) => {
            broadcast(projectId, {
              type: 'test.output',
              ...(requestId ? { requestId } : {}),
              line,
            });
          },
          controller.signal,
          file,
        );
        const cancelled = controller.signal.aborted || result.exitCode === 130;
        broadcast(projectId, {
          type: 'test.finished',
          ...(requestId ? { requestId } : {}),
          status: cancelled ? 'cancelled' : result.exitCode === 0 ? 'passed' : 'failed',
          summary: {
            passed: !cancelled && result.exitCode === 0 ? 1 : 0,
            failed: !cancelled && result.exitCode !== 0 ? 1 : 0,
            skipped: 0,
            durationMs: Date.now() - startedAt,
          },
        });
      } finally {
        tests.delete(projectId);
      }
    }

    function stopTests(): void {
      const controller = tests.get(projectId);
      if (!controller) {
        throw new HttpError(409, 'not_running', 'No test run is in progress');
      }
      controller.abort();
    }
  });
}

function summarizeContext(context: FrontendContextPayload): ContextSummary {
  const selections: ContextSummary['selections'] = [];
  const selected = context.selectedElement;
  if (selected?.tagName.trim()) {
    const loc = selected.sourceLocation;
    selections.push({
      tagName: selected.tagName,
      ...(selected.id ? { id: selected.id } : {}),
      ...(selected.className ? { className: selected.className } : {}),
      ...(loc?.componentName ? { componentName: loc.componentName } : {}),
      ...(loc?.fileName ? { fileName: loc.fileName } : {}),
      ...(loc ? { lineNumber: loc.lineNumber, columnNumber: loc.columnNumber } : {}),
    });
  }
  return {
    selections,
    errorCount: context.recentErrors.length,
    logCount: context.recentConsoleLogs.length,
    failedRequestCount: context.failedNetworkRequests.length,
    screenshotAttached: Boolean(context.screenshotBase64),
  };
}

async function openThread(
  deps: ServerDeps,
  projectId: string,
  message: Extract<WorkspaceClientMessage, { type: 'run.start' }>,
): Promise<Thread> {
  if (message.threadId) {
    const existing = await deps.threads.getThread(message.threadId);
    if (existing) {
      if (existing.thread.projectId !== projectId) {
        throw new HttpError(404, 'not_found', `Thread ${message.threadId} was not found`);
      }
      const thread = existing.thread;
      return deps.threads.updateThread(thread.id, {
        provider: message.provider,
        mode: message.mode,
        ...(message.model ? { model: message.model } : {}),
        ...(thread.provider !== message.provider ? { providerSessionId: null } : {}),
      });
    }
  }
  return deps.threads.createThread({
    projectId,
    provider: message.provider,
    model: message.model ?? null,
    mode: message.mode,
    title: threadTitle(message.prompt),
    keep: true,
    source: 'overlay',
  });
}

async function resumeSessionId(deps: ServerDeps, thread: Thread, provider: Thread['provider']): Promise<string | undefined> {
  if (!thread.providerSessionId || thread.provider !== provider) return undefined;
  if (!(await providerSupportsResume(deps, provider))) return undefined;
  return thread.providerSessionId;
}

function asFailure(error: unknown): { code: string; message: string } {
  if (error instanceof HttpError) return { code: error.code, message: error.message };
  if (error instanceof ThreadStoreError) return { code: 'thread_store', message: error.message };
  if (error instanceof PathEscapeError) return { code: 'path_escape', message: error.message };
  const message = error instanceof Error ? error.message : 'Request failed';
  if (/escapes the project root|invalid path/i.test(message)) return { code: 'path_escape', message };
  return { code: 'git_error', message };
}

function encode(message: WorkspaceServerMessage): string | undefined {
  const parsed = WorkspaceServerMessageSchema.safeParse(message);
  if (!parsed.success) {
    logger.error(parsed.error.issues.map((issue) => issue.message).join('; '));
    return undefined;
  }
  return JSON.stringify(parsed.data);
}

function write(socket: WebSocket, payload: string): void {
  if (socket.readyState !== WS_OPEN) return;
  try {
    socket.send(payload);
  } catch {
    // The client went away.
  }
}

function requestIdOf(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object' || !('requestId' in payload)) return undefined;
  const value = (payload as { requestId?: unknown }).requestId;
  return typeof value === 'string' && value ? value : undefined;
}

function messageText(data: unknown): string {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (Array.isArray(data) && data.every((part) => Buffer.isBuffer(part))) {
    return Buffer.concat(data).toString('utf8');
  }
  return String(data);
}
