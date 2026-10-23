import { GitDiffSummarySchema, type GitCommitRequest, type GitDiffSummary } from '@gateway/shared-types';
import type { DevtoolsBridge } from '../types.js';

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
export const STOP_TESTS_EVENT = 'ai-devtools:stop-tests';
export const TEST_OUTPUT_EVENT = 'ai-devtools:test-output';
export const TEST_DONE_EVENT = 'ai-devtools:test-done';

const BRIDGE_UNAVAILABLE = 'Dev server bridge is unavailable';

export interface DevtoolsWindowConfig {
  wsToken?: string;
  wsBase?: string;
  /** Gateway origin injected by the Vite plugin. */
  gatewayUrl?: string;
  /** Absolute project root the agent should edit. */
  cwd?: string;
  /** package.json name of the Vite project, when it has one. */
  projectName?: string;
}

interface BridgeMessage {
  requestId?: string;
  ok?: boolean;
  error?: string;
  [key: string]: unknown;
}

type MessageListener = (data: BridgeMessage) => void;

export function devtoolsSocketUrl(
  token: string,
  base: string,
  locationLike: { protocol: string; host: string },
): string {
  const protocol = locationLike.protocol === 'https:' ? 'wss:' : 'ws:';
  const normalized = base.endsWith('/') ? base : `${base}/`;
  return `${protocol}//${locationLike.host}${normalized}?token=${encodeURIComponent(token)}`;
}

export function readDevtoolsWindowConfig(): DevtoolsWindowConfig {
  const host = globalThis as { __AI_DEVTOOLS__?: DevtoolsWindowConfig };
  return host.__AI_DEVTOOLS__ ?? {};
}

/** Connect to Vite's HMR socket when the plugin injected a token. Otherwise fail closed. */
export function createDevtoolsBridge(
  locationLike: { protocol: string; host: string } = globalThis.location,
): DevtoolsBridge {
  const config = readDevtoolsWindowConfig();
  if (!config.wsToken || typeof WebSocket === 'undefined' || !locationLike?.host) {
    return unavailableBridge();
  }
  return new ViteHmrBridge(devtoolsSocketUrl(config.wsToken, config.wsBase || '/', locationLike));
}

class ViteHmrBridge implements DevtoolsBridge {
  private socket: WebSocket | null = null;
  private opening: Promise<WebSocket> | null = null;
  private requestSerial = 0;
  private testRequestId: string | null = null;
  private readonly pending = new Map<
    string,
    { resolve: (data: BridgeMessage) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private readonly listeners = new Map<string, Set<MessageListener>>();

  constructor(private readonly url: string) {}

  gitDiff(): Promise<GitDiffSummary> {
    return this.request(GIT_DIFF_EVENT, {}, 60_000).then((data) => GitDiffSummarySchema.parse(data.diff));
  }

  async gitCommit(request: GitCommitRequest): Promise<{ commitHash: string; branch: string }> {
    const data = await this.request(GIT_COMMIT_EVENT, { ...request }, 60_000);
    if (typeof data.commitHash !== 'string' || typeof data.branch !== 'string') {
      throw new Error('Git did not return a commit');
    }
    return { commitHash: data.commitHash, branch: data.branch };
  }

  async gitRevert(files?: string[]): Promise<void> {
    await this.request(GIT_REVERT_EVENT, files ? { files } : {}, 60_000);
  }

  async runTests(onLine: (line: string) => void): Promise<{ exitCode: number; command: string; cancelled?: boolean }> {
    const requestId = this.nextRequestId();
    this.testRequestId = requestId;
    const off = this.subscribe(TEST_OUTPUT_EVENT, (data) => {
      if (data.requestId === requestId && typeof data.line === 'string') onLine(data.line);
    });
    try {
      const data = await this.request(RUN_TESTS_EVENT, { requestId }, 10 * 60_000);
      return {
        exitCode: typeof data.exitCode === 'number' ? data.exitCode : 1,
        command: typeof data.command === 'string' ? data.command : '',
        ...(data.cancelled === true ? { cancelled: true } : {}),
      };
    } finally {
      off();
      if (this.testRequestId === requestId) this.testRequestId = null;
    }
  }

  stopTests(): void {
    const requestId = this.testRequestId;
    if (!requestId) return;
    void this.send(STOP_TESTS_EVENT, { requestId });
  }

  async spawnPty(cols: number, rows: number): Promise<{ sessionId: string; fallback: boolean }> {
    const data = await this.request(PTY_SPAWN_EVENT, { cols, rows }, 15_000);
    if (typeof data.sessionId !== 'string') throw new Error('Terminal did not start');
    return { sessionId: data.sessionId, fallback: data.fallback === true };
  }

  writePty(sessionId: string, data: string): void {
    void this.send(PTY_INPUT_EVENT, { sessionId, data });
  }

  resizePty(sessionId: string, cols: number, rows: number): void {
    void this.send(PTY_RESIZE_EVENT, { sessionId, cols, rows });
  }

  disposePty(sessionId: string): void {
    void this.send(PTY_DISPOSE_EVENT, { sessionId });
  }

  onPtyData(listener: (sessionId: string, data: string) => void): () => void {
    return this.subscribe(PTY_DATA_EVENT, (message) => {
      if (typeof message.sessionId === 'string' && typeof message.data === 'string') {
        listener(message.sessionId, message.data);
      }
    });
  }

  onPtyExit(listener: (sessionId: string, code: number) => void): () => void {
    return this.subscribe(PTY_EXIT_EVENT, (message) => {
      if (typeof message.sessionId === 'string' && typeof message.code === 'number') {
        listener(message.sessionId, message.code);
      }
    });
  }

  private subscribe(event: string, listener: MessageListener): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
    return () => set?.delete(listener);
  }

  private request(event: string, data: Record<string, unknown>, timeoutMs: number): Promise<BridgeMessage> {
    const requestId = typeof data.requestId === 'string' ? data.requestId : this.nextRequestId();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('Dev server bridge timed out'));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      void this.send(event, { ...data, requestId }).catch((error: unknown) => {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(error instanceof Error ? error : new Error(BRIDGE_UNAVAILABLE));
      });
    });
  }

  private async send(event: string, data: Record<string, unknown>): Promise<void> {
    const socket = await this.connect();
    socket.send(JSON.stringify({ type: 'custom', event, data }));
  }

  private connect(): Promise<WebSocket> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) return Promise.resolve(this.socket);
    if (this.opening) return this.opening;
    const pending = new Promise<WebSocket>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const succeed = (value: WebSocket): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve(value);
      };
      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        reject(error);
      };
      let socket: WebSocket;
      try {
        socket = new WebSocket(this.url, 'vite-hmr');
      } catch (error) {
        fail(error instanceof Error ? error : new Error(BRIDGE_UNAVAILABLE));
        return;
      }
      timer = setTimeout(() => {
        socket.close();
        fail(new Error('Dev server bridge timed out'));
      }, 5_000);
      socket.onopen = () => {
        this.socket = socket;
        succeed(socket);
      };
      socket.onerror = () => {
        if (!settled) fail(new Error('Dev server bridge connection failed'));
      };
      socket.onmessage = (event) => this.handleMessage(String(event.data));
      socket.onclose = () => {
        if (this.socket === socket) this.socket = null;
        if (!settled) fail(new Error('Dev server bridge disconnected'));
        this.rejectPending(new Error('Dev server bridge disconnected'));
      };
    });
    this.opening = pending;
    void pending.finally(() => {
      if (this.opening === pending) this.opening = null;
    });
    return pending;
  }

  private handleMessage(raw: string): void {
    let payload: { type?: string; event?: string; data?: BridgeMessage };
    try {
      payload = JSON.parse(raw) as { type?: string; event?: string; data?: BridgeMessage };
    } catch {
      return;
    }
    if (payload.type !== 'custom' || !payload.event) return;
    const data = payload.data ?? {};
    if (typeof data.requestId === 'string' && typeof data.ok === 'boolean') {
      const pending = this.pending.get(data.requestId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(data.requestId);
        if (data.ok) pending.resolve(data);
        else pending.reject(new Error(typeof data.error === 'string' ? data.error : 'Request failed'));
      }
    }
    for (const listener of this.listeners.get(payload.event) ?? []) listener(data);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private nextRequestId(): string {
    this.requestSerial += 1;
    return `req_${this.requestSerial}`;
  }
}

function unavailableBridge(): DevtoolsBridge {
  const fail = (): Promise<never> => Promise.reject(new Error(BRIDGE_UNAVAILABLE));
  return {
    gitDiff: fail,
    gitCommit: fail,
    gitRevert: fail,
    runTests: fail,
    stopTests() {},
    spawnPty: fail,
    writePty() {},
    resizePty() {},
    disposePty() {},
    onPtyData() {
      return () => {};
    },
    onPtyExit() {
      return () => {};
    },
  };
}
