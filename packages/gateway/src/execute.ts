import { randomUUID } from 'node:crypto';
import {
  BinaryNotFoundError,
  CliAuthError,
  PathEscapeError,
  ProcessTimeoutError,
  confineWorkspace,
  isInsideRoot,
  logger,
  type CLIAdapter,
} from '@aidev/adapters';
import {
  createStreamEvent,
  type PromptOptions,
  type PromptRequest,
  type Run,
  type SessionStatus,
  type UnifiedStreamEvent,
} from '@aidev/protocol';
import type { Principal } from './auth/principal.js';
import { HttpError } from './errors.js';
import type { SessionRegistry } from './sessions/registry.js';
import { projectForPath, runFromOutcome, runningRun, threadTitle, type ThreadRunBinding } from './threads/run.js';
import type { ThreadPatch } from './threads/store.js';
import type { ServerDeps } from './types.js';

export interface ExecutionOutcome {
  sessionId: string;
  exitCode: number;
  summary: string;
  events: UnifiedStreamEvent[];
  status: SessionStatus;
  error?: unknown;
  /** Set when this execution is stored as a thread run. */
  run?: Run;
}

export interface StartExecutionOptions {
  /** Persist events onto this run. The caller created the thread and the run. */
  binding?: ThreadRunBinding;
  /** Create a one-run `api` thread. Ignored when `binding` is set. */
  recordApi?: boolean;
  /**
   * Events written to the thread log before the adapter's own events.
   * They are not copied into the session buffer.
   */
  prelude?: UnifiedStreamEvent[];
}

export interface StartedExecution {
  sessionId: string;
  done: Promise<ExecutionOutcome>;
}

/**
 * Resolve the CLI, record a running session, and execute in the background.
 * The returned promise settles when the child exits; callers that stream do
 * not need to await it before telling the client the session id.
 */
export async function startExecution(
  deps: ServerDeps,
  request: PromptRequest,
  sessionId: string = request.sessionId ?? `sess_${randomUUID()}`,
  principal?: Principal,
  options: StartExecutionOptions = {},
): Promise<StartedExecution> {
  if (!principal) throw new HttpError(401, 'unauthorized', 'A bearer token is required');
  const prompt = await confineRequest(deps, request, principal);
  const adapter = await prepareAdapter(deps, prompt, sessionId);
  const binding = options.binding ?? (options.recordApi ? await createApiBinding(deps, prompt) : undefined);
  try {
    deps.registry.create({
      id: sessionId,
      provider: prompt.provider,
      cwd: prompt.cwd,
      adapter,
      ...(prompt.ephemeral !== undefined ? { ephemeral: prompt.ephemeral } : {}),
    });
  } catch (error) {
    if (binding && !options.binding) await abortThreadRun(deps, binding, error);
    throw error;
  }
  logger.info(`session ${sessionId} started (${prompt.provider})`);
  let settle = (): void => {};
  const settled = new Promise<void>((resolve) => {
    settle = resolve;
  });
  if (binding) {
    deps.runs.add({
      runId: binding.runId,
      threadId: binding.threadId,
      sessionId,
      settled,
    });
  }
  const execution = executeSession(deps, adapter, prompt, sessionId, binding, options.prelude);
  const done = binding
    ? execution.finally(() => {
        deps.runs.remove(binding.runId);
        settle();
      })
    : execution;
  return { sessionId, done };
}

/**
 * Mark a run failed when the CLI never started.
 * Callers that created the binding use this; `recordApi` failures are handled inside `startExecution`.
 */
export async function abortThreadRun(deps: ServerDeps, binding: ThreadRunBinding, error: unknown): Promise<void> {
  const http = executionHttpError(error);
  const setup = Array.isArray(http.details) && http.details.every((item) => typeof item === 'string') ? http.details : undefined;
  const run = runFromOutcome(binding, { status: 'failed', exitCode: 1, events: [] });
  const failed = {
    ...run,
    error: {
      code: http.code,
      message: http.message,
      ...(setup ? { setup } : {}),
    },
  };
  try {
    await deps.threads.updateRun(binding.threadId, failed);
  } catch (updateError) {
    logger.error(updateError instanceof Error ? updateError.message : 'failed run was not saved');
  }
}

/**
 * Stop a running session. `markKilled` happens before the signal so the exit
 * path cannot record the session as completed. The kill is retried briefly
 * because the child is registered only after the binary has been resolved.
 */
export async function cancelSession(
  registry: SessionRegistry,
  sessionId: string,
): Promise<ReturnType<SessionRegistry['get']>> {
  const existing = registry.get(sessionId);
  if (!existing) return undefined;
  if (existing.status !== 'running' && existing.status !== 'pending') return existing;
  const marked = registry.markKilled(sessionId);
  const adapter = registry.adapterFor(sessionId);
  if (adapter) await signalUntilRegistered(adapter, registry, sessionId);
  return marked;
}

async function prepareAdapter(
  deps: ServerDeps,
  request: PromptRequest,
  sessionId: string,
): Promise<CLIAdapter> {
  if (deps.registry.get(sessionId)) {
    throw new HttpError(409, 'session_exists', `Session ${sessionId} already exists`);
  }
  let adapter: CLIAdapter;
  try {
    adapter = deps.runtime.getAdapter(request.provider);
  } catch (error) {
    const message = error instanceof Error ? error.message : `Provider ${request.provider} is not available`;
    throw new HttpError(422, 'provider_unavailable', message);
  }
  try {
    await adapter.getBinaryPath();
  } catch (error) {
    if (error instanceof BinaryNotFoundError) {
      throw new HttpError(422, 'provider_unavailable', error.message, error.setup);
    }
    throw error;
  }
  return adapter;
}

async function executeSession(
  deps: ServerDeps,
  adapter: CLIAdapter,
  request: PromptRequest,
  sessionId: string,
  binding?: ThreadRunBinding,
  prelude?: UnifiedStreamEvent[],
): Promise<ExecutionOutcome> {
  const registry = deps.registry;
  const persist = (event: UnifiedStreamEvent): void => {
    if (!binding) return;
    try {
      // FileThreadStore writes before the promise is returned, so the JSONL
      // line is on disk before `registry.append` notifies subscribers.
      const written = deps.threads.appendEvent(binding.threadId, binding.runId, event);
      if (event.type === 'session_info' && event.payload.providerSessionId) {
        const patch: ThreadPatch = { providerSessionId: event.payload.providerSessionId };
        if (event.payload.model) patch.model = event.payload.model;
        deps.threads.updateThread(binding.threadId, patch);
      }
      void written.catch((error: unknown) => {
        logger.error(error instanceof Error ? error.message : 'thread event was not stored');
      });
    } catch (error) {
      logger.error(error instanceof Error ? error.message : 'thread event was not stored');
    }
  };
  if (prelude) {
    for (const event of prelude) persist(event);
  }
  const publish = (event: UnifiedStreamEvent): void => {
    persist(event);
    registry.append(sessionId, event);
  };
  try {
    const result = await adapter.execute(toPromptOptions(request, sessionId), publish);
    const status: SessionStatus =
      registry.get(sessionId)?.status === 'killed'
        ? 'killed'
        : result.exitCode === 0
          ? 'completed'
          : 'failed';
    ensureTerminalEvents(registry, sessionId, undefined, publish);
    const record = registry.finish(sessionId, { status, exitCode: result.exitCode });
    logger.info(`session ${sessionId} ${record?.status ?? status} (exit ${result.exitCode})`);
    const outcome: ExecutionOutcome = {
      sessionId,
      exitCode: result.exitCode,
      summary: result.summary,
      events: registry.events(sessionId) ?? [],
      status: record?.status ?? status,
    };
    if (binding) outcome.run = await saveRun(deps, binding, outcome);
    return outcome;
  } catch (error) {
    const status = statusForError(registry.get(sessionId)?.status, error);
    ensureTerminalEvents(registry, sessionId, error, publish);
    const record = registry.finish(sessionId, { status, exitCode: 1 });
    const message = error instanceof Error ? error.message : 'Prompt execution failed';
    logger.error(`session ${sessionId} ${status}: ${message}`);
    const outcome: ExecutionOutcome = {
      sessionId,
      exitCode: 1,
      summary: '',
      events: registry.events(sessionId) ?? [],
      status: record?.status ?? status,
      error,
    };
    if (binding) outcome.run = await saveRun(deps, binding, outcome);
    return outcome;
  }
}

function toPromptOptions(request: PromptRequest, sessionId: string): PromptOptions {
  return {
    prompt: request.prompt,
    cwd: request.cwd,
    sessionId,
    ...(request.allowedTools !== undefined ? { allowedTools: request.allowedTools } : {}),
    ...(request.yolo !== undefined ? { yolo: request.yolo } : {}),
    ...(request.systemPrompt !== undefined ? { systemPrompt: request.systemPrompt } : {}),
    ...(request.files !== undefined ? { files: request.files } : {}),
    ...(request.ephemeral !== undefined ? { ephemeral: request.ephemeral } : {}),
    ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
    ...(request.providerSessionId !== undefined ? { providerSessionId: request.providerSessionId } : {}),
    ...(request.model !== undefined ? { model: request.model } : {}),
    ...(request.mode !== undefined ? { mode: request.mode } : {}),
  };
}

function statusForError(current: SessionStatus | undefined, error: unknown): SessionStatus {
  if (current === 'killed') return 'killed';
  if (error instanceof ProcessTimeoutError) return 'timed_out';
  return 'failed';
}

function ensureTerminalEvents(
  registry: SessionRegistry,
  sessionId: string,
  error: unknown | undefined,
  publish: (event: UnifiedStreamEvent) => void,
): void {
  const current = registry.events(sessionId) ?? [];
  if (error !== undefined && !current.some((event) => event.type === 'error')) {
    const message = error instanceof Error ? error.message : 'Prompt execution failed';
    publish(createStreamEvent(sessionId, 'error', { error: message }));
  }
  const afterError = registry.events(sessionId) ?? [];
  if (!afterError.some((event) => event.type === 'done')) {
    publish(createStreamEvent(sessionId, 'done', {}));
  }
}

async function createApiBinding(deps: ServerDeps, request: PromptRequest): Promise<ThreadRunBinding> {
  const project = projectForPath(deps.projects, request.cwd);
  const thread = await deps.threads.createThread({
    projectId: project?.id ?? null,
    provider: request.provider,
    model: request.model ?? null,
    mode: request.mode ?? 'agent',
    title: threadTitle(request.prompt),
    keep: request.ephemeral !== true,
    source: 'api',
  });
  const run = runningRun({
    threadId: thread.id,
    prompt: request.prompt,
    contextSummary: null,
    attachments: [],
  });
  await deps.threads.updateRun(thread.id, run);
  return {
    threadId: thread.id,
    runId: run.id,
    prompt: request.prompt,
    startedAt: run.startedAt,
    contextSummary: null,
    attachments: [],
  };
}

async function saveRun(
  deps: ServerDeps,
  binding: ThreadRunBinding,
  outcome: ExecutionOutcome,
): Promise<Run> {
  const run = runFromOutcome(binding, outcome);
  try {
    return await deps.threads.updateRun(binding.threadId, run);
  } catch (error) {
    logger.error(error instanceof Error ? error.message : 'run record was not saved');
    return run;
  }
}

async function signalUntilRegistered(
  adapter: CLIAdapter,
  registry: SessionRegistry,
  sessionId: string,
): Promise<void> {
  const deadline = Date.now() + 1_000;
  for (;;) {
    if (await adapter.kill(sessionId)) return;
    const events = registry.events(sessionId) ?? [];
    if (events.some((event) => event.type === 'done')) return;
    if (Date.now() >= deadline) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

/** Roots a principal may read or edit. A browser token has exactly one. */
export function rootsFor(deps: ServerDeps, principal: Principal): string[] {
  if (principal.kind === 'browser') {
    const project = deps.projects.get(principal.projectId);
    return project ? [project.root] : [];
  }
  return deps.projects.roots();
}

export function sessionVisible(deps: ServerDeps, principal: Principal, cwd: string): boolean {
  return rootsFor(deps, principal).some((root) => isInsideRoot(root, cwd));
}

export function countActiveRuns(deps: ServerDeps, principal: Principal): number {
  return deps.registry.list().filter((record) => {
    if (record.status !== 'running' && record.status !== 'pending') return false;
    if (principal.kind === 'machine') return true;
    return sessionVisible(deps, principal, record.cwd);
  }).length;
}

async function confineRequest(
  deps: ServerDeps,
  request: PromptRequest,
  principal: Principal,
): Promise<PromptRequest> {
  const roots = rootsFor(deps, principal);
  if (roots.length === 0) {
    throw new HttpError(400, 'path_escape', 'No project is registered for this path');
  }
  let last: unknown;
  for (const root of roots) {
    try {
      const confined = await confineWorkspace(root, request.cwd, request.files ?? []);
      return {
        ...request,
        cwd: confined.cwd,
        ...(request.files !== undefined ? { files: confined.files } : {}),
      };
    } catch (error) {
      if (!(error instanceof PathEscapeError)) throw error;
      last = error;
    }
  }
  const message = last instanceof PathEscapeError ? last.message : 'Path escapes the project root';
  throw new HttpError(400, 'path_escape', message);
}

export function executionHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  if (error instanceof BinaryNotFoundError) {
    return new HttpError(422, 'provider_unavailable', error.message, error.setup);
  }
  if (error instanceof CliAuthError) {
    return new HttpError(422, 'cli_auth_required', error.message, error.setup);
  }
  if (error instanceof PathEscapeError) {
    return new HttpError(400, 'path_escape', error.message);
  }
  if (error instanceof ProcessTimeoutError) {
    return new HttpError(504, 'timeout', error.message);
  }
  if (error instanceof Error && /cwd (does not exist|is not a directory)/.test(error.message)) {
    return new HttpError(400, 'invalid_cwd', error.message);
  }
  const message = error instanceof Error ? error.message : 'Prompt execution failed';
  return new HttpError(500, 'execution_failed', message);
}
