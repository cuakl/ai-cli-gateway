import type { GitDiffSummary, WorkspaceClientMessage, WorkspaceServerMessage } from '@aidev/protocol';
import type { WorkspaceConnection, WorkspaceConnectionState } from '../src/ui/workspace-client.js';

export interface FakeWorkspaceOptions {
  state?: WorkspaceConnectionState;
  summary?: GitDiffSummary;
  /** Return a reply to replace the default. Return `undefined` to use the default. */
  onRequest?: (
    message: WorkspaceClientMessage,
    emit: (message: WorkspaceServerMessage) => void,
  ) => WorkspaceServerMessage | undefined;
  /** Replaces the default `test.run` / `test.stop` push behavior. */
  onSend?: (message: WorkspaceClientMessage, emit: (message: WorkspaceServerMessage) => void) => void;
}

export interface FakeWorkspace extends WorkspaceConnection {
  sent: WorkspaceClientMessage[];
  setState(state: WorkspaceConnectionState): void;
  emit(message: WorkspaceServerMessage): void;
}

const EMPTY_SUMMARY: GitDiffSummary = { files: [], insertions: 0, deletions: 0 };

export function createFakeWorkspace(options: FakeWorkspaceOptions = {}): FakeWorkspace {
  let state: WorkspaceConnectionState = options.state ?? 'closed';
  const sent: WorkspaceClientMessage[] = [];
  const listeners = new Map<string, Set<(message: WorkspaceServerMessage) => void>>();
  const stateListeners = new Set<(next: WorkspaceConnectionState) => void>();
  const summary = options.summary ?? EMPTY_SUMMARY;

  function emit(message: WorkspaceServerMessage): void {
    const set = listeners.get(message.type);
    if (!set) return;
    for (const handler of [...set]) handler(message);
  }

  function setState(next: WorkspaceConnectionState): void {
    if (state === next) return;
    state = next;
    for (const listener of [...stateListeners]) listener(next);
  }

  function stamp(message: WorkspaceClientMessage): WorkspaceClientMessage {
    const requestId = message.requestId ?? `req_${sent.length + 1}`;
    return { ...message, requestId };
  }

  return {
    sent,
    get state() {
      return state;
    },
    setState,
    emit,
    request(message) {
      const stamped = stamp(message);
      sent.push(stamped);
      const reply = options.onRequest?.(stamped, emit) ?? defaultReply(stamped, summary);
      return Promise.resolve(reply as never);
    },
    send(message) {
      const stamped = stamp(message);
      sent.push(stamped);
      if (options.onSend) options.onSend(stamped, emit);
      else defaultSend(stamped, emit);
    },
    on(type, handler) {
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      const wrapped = handler as (message: WorkspaceServerMessage) => void;
      set.add(wrapped);
      return () => {
        set?.delete(wrapped);
      };
    },
    onStateChange(listener) {
      stateListeners.add(listener);
      return () => {
        stateListeners.delete(listener);
      };
    },
    close() {
      setState('closed');
    },
  };
}

function defaultReply(message: WorkspaceClientMessage, summary: GitDiffSummary): WorkspaceServerMessage {
  switch (message.type) {
    case 'git.diff':
      return { type: 'git.diff.result', requestId: message.requestId, summary };
    case 'git.commit':
      return {
        type: 'git.commit.result',
        requestId: message.requestId,
        commitHash: 'abc1234def',
        branch: 'main',
        pushed: message.push,
      };
    case 'git.discard':
      return { type: 'git.discard.result', requestId: message.requestId, paths: message.paths };
    case 'pty.spawn':
      return {
        type: 'pty.spawn.result',
        requestId: message.requestId,
        sessionId: 'pty_test',
        fallback: false,
      };
    case 'run.start':
      return {
        type: 'run.accepted',
        requestId: message.requestId,
        threadId: 'thr_test',
        runId: 'run_test',
      };
    case 'files.search':
      return { type: 'files.search.result', requestId: message.requestId, files: [] };
    case 'editor.open':
      return { type: 'editor.open.result', requestId: message.requestId, file: message.file };
    case 'thread.list':
      return { type: 'thread.list.result', requestId: message.requestId, threads: [] };
    case 'thread.get':
      return {
        type: 'thread.get.result',
        requestId: message.requestId,
        thread: {
          id: message.threadId,
          projectId: 'proj_test',
          provider: 'cursor',
          model: null,
          mode: 'agent',
          providerSessionId: null,
          title: 'Untitled',
          createdAt: 1,
          updatedAt: 1,
          keep: true,
          source: 'overlay',
        },
        runs: [],
        events: [],
      };
    case 'git.checkpoint.restore':
      return {
        type: 'git.checkpoint.restore.result',
        requestId: message.requestId,
        runId: message.runId,
        files: [],
      };
    case 'git.status':
      return {
        type: 'git.status.result',
        requestId: message.requestId,
        status: {
          branch: summary.branch ?? 'main',
          clean: summary.files.length === 0,
          conflicted: [],
          dirty: summary.files.map((file) => file.path),
          ghAvailable: false,
        },
      };
    case 'git.log':
      return { type: 'git.log.result', requestId: message.requestId, commits: [] };
    case 'git.discard.hunk':
      return {
        type: 'git.discard.hunk.result',
        requestId: message.requestId,
        path: message.path,
        hunkIndex: message.hunkIndex,
      };
    case 'git.branch.create':
      return { type: 'git.branch.create.result', requestId: message.requestId, name: message.name };
    case 'git.pr.create':
      return {
        type: 'git.pr.create.result',
        requestId: message.requestId,
        url: 'https://github.com/example/demo/pull/1',
      };
    case 'git.commit.undo':
      return { type: 'git.commit.undo.result', requestId: message.requestId, hash: 'abc1234def' };
    case 'commit.suggest':
      return {
        type: 'commit.suggest.result',
        requestId: message.requestId,
        message: 'feat: generated message',
      };
    default:
      return {
        type: 'error',
        requestId: message.requestId,
        code: 'not_implemented',
        message: `${message.type} is not stubbed`,
      };
  }
}

function defaultSend(message: WorkspaceClientMessage, emit: (message: WorkspaceServerMessage) => void): void {
  if (message.type === 'test.run') {
    emit({ type: 'test.output', requestId: message.requestId, line: '1 passed' });
    emit({
      type: 'test.finished',
      requestId: message.requestId,
      status: 'passed',
      summary: { passed: 1, failed: 0, skipped: 0, durationMs: 4 },
    });
  }
  if (message.type === 'test.stop') {
    emit({
      type: 'test.finished',
      requestId: message.requestId,
      status: 'cancelled',
      summary: { passed: 0, failed: 0, skipped: 0, durationMs: 1 },
    });
  }
}
