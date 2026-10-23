import {
  WorkspaceClientMessageSchema,
  WorkspaceServerMessageSchema,
  type WorkspaceClientMessage,
  type WorkspaceServerMessage,
} from '@aidev/protocol';

const RECONNECT_MIN_MS = 250;
const RECONNECT_MAX_MS = 5_000;
const REQUEST_TIMEOUT_MS = 30_000;

export type WorkspaceConnectionState = 'connecting' | 'open' | 'closed';

/** Minimal socket surface so tests can inject a fake constructor. */
export interface WorkspaceSocket {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: Event) => void) | null;
}

export type WorkspaceSocketConstructor = new (url: string) => WorkspaceSocket;

export interface WorkspaceClientOptions {
  gatewayUrl: string;
  projectId: string;
  browserToken: string;
  /** Defaults to the global `WebSocket`. Tests pass a fake. */
  WebSocket?: WorkspaceSocketConstructor;
}

type ReplyTypeFor<T extends WorkspaceClientMessage['type']> = T extends 'run.start'
  ? 'run.accepted'
  : `${T}.result`;

export type WorkspaceReply<T extends WorkspaceClientMessage['type']> = Extract<
  WorkspaceServerMessage,
  { type: ReplyTypeFor<T> }
>;

/**
 * What the overlay needs from the project socket.
 * Tests pass a fake with the same shape.
 */
export interface WorkspaceConnection {
  readonly state: WorkspaceConnectionState;
  request<T extends WorkspaceClientMessage>(
    message: T,
  ): Promise<WorkspaceReply<T['type']>>;
  /**
   * Transmit a command that has no `<type>.result` reply.
   * `run.cancel`, `pty.input`, `pty.resize`, `pty.dispose`, `test.run`, and `test.stop`.
   */
  send(message: WorkspaceClientMessage): void;
  on<T extends WorkspaceServerMessage['type']>(
    type: T,
    handler: (message: Extract<WorkspaceServerMessage, { type: T }>) => void,
  ): () => void;
  onStateChange(listener: (state: WorkspaceConnectionState) => void): () => void;
  close(): void;
}

export class WorkspaceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'WorkspaceError';
    this.code = code;
  }
}

interface PendingRequest {
  type: WorkspaceClientMessage['type'];
  resolve: (message: WorkspaceServerMessage) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

type ServerHandler = (message: WorkspaceServerMessage) => void;

/**
 * Multiplexed project WebSocket.
 * Replies are matched on `requestId`: `<type>.result`, `run.accepted`, or `error`.
 */
const DEVTOOLS_CONFIG_PATH = '/@ai-devtools/config';

export class WorkspaceClient implements WorkspaceConnection {
  private connectionState: WorkspaceConnectionState = 'connecting';
  private url: string;
  private readonly gatewayUrl: string;
  private readonly Socket: WorkspaceSocketConstructor;
  private sawOpen = false;
  private refreshTask: Promise<void> | null = null;
  private socket: WorkspaceSocket | null = null;
  private stopped = false;
  private retryDelayMs = RECONNECT_MIN_MS;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly outbound: string[] = [];
  private readonly pending = new Map<string, PendingRequest>();
  private readonly listeners = new Map<WorkspaceServerMessage['type'], Set<ServerHandler>>();
  private readonly stateListeners = new Set<(state: WorkspaceConnectionState) => void>();

  constructor(options: WorkspaceClientOptions) {
    this.gatewayUrl = options.gatewayUrl;
    this.Socket = options.WebSocket ?? (globalThis.WebSocket as unknown as WorkspaceSocketConstructor);
    try {
      this.url = workspaceSocketUrl(options.gatewayUrl, options.projectId, options.browserToken);
    } catch {
      this.url = '';
      this.stopped = true;
      this.connectionState = 'closed';
      return;
    }
    if (typeof this.Socket !== 'function') {
      this.stopped = true;
      this.connectionState = 'closed';
      return;
    }
    this.sawOpen = false;
    this.connect();
  }

  get state(): WorkspaceConnectionState {
    return this.connectionState;
  }

  request<T extends WorkspaceClientMessage>(message: T): Promise<WorkspaceReply<T['type']>> {
    const requestId = message.requestId ?? nextRequestId();
    const parsed = WorkspaceClientMessageSchema.safeParse({ ...message, requestId });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const detail = issue ? `${issue.path.join('.') || 'message'}: ${issue.message}` : 'Invalid message';
      return Promise.reject(new WorkspaceError('validation_error', detail));
    }
    const payload = parsed.data;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new WorkspaceError('timeout', 'Workspace request timed out'));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(requestId, {
        type: payload.type,
        resolve: resolve as (message: WorkspaceServerMessage) => void,
        reject,
        timer,
      });
      this.transmit(JSON.stringify(payload));
    });
  }

  send(message: WorkspaceClientMessage): void {
    const requestId = message.requestId ?? nextRequestId();
    const parsed = WorkspaceClientMessageSchema.safeParse({ ...message, requestId });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const detail = issue ? `${issue.path.join('.') || 'message'}: ${issue.message}` : 'Invalid message';
      throw new WorkspaceError('validation_error', detail);
    }
    this.transmit(JSON.stringify(parsed.data));
  }

  on<T extends WorkspaceServerMessage['type']>(
    type: T,
    handler: (message: Extract<WorkspaceServerMessage, { type: T }>) => void,
  ): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    const wrapped = handler as ServerHandler;
    set.add(wrapped);
    return () => {
      set?.delete(wrapped);
    };
  }

  onStateChange(listener: (state: WorkspaceConnectionState) => void): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  close(): void {
    this.stopped = true;
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.failPending(new WorkspaceError('disconnected', 'Workspace connection closed'));
    this.setState('closed');
  }

  private connect(): void {
    if (this.stopped) return;
    this.setState('connecting');
    let socket: WorkspaceSocket;
    try {
      socket = new this.Socket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.sawOpen = false;
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.sawOpen = true;
      this.retryDelayMs = RECONNECT_MIN_MS;
      this.setState('open');
      this.flush();
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      this.handleIncoming(event.data);
    };
    socket.onerror = () => {
      // `close` follows and owns the retry. Handling both would reconnect twice.
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      const opened = this.sawOpen;
      this.sawOpen = false;
      this.failSocket(socket, event ?? new Event('close'), opened);
    };
  }

  private failSocket(socket: WorkspaceSocket, event: Event, opened: boolean): void {
    if (this.socket !== socket) return;
    this.socket = null;
    this.failPending(new WorkspaceError('disconnected', 'Workspace connection closed'));
    if (this.stopped) {
      this.setState('closed');
      return;
    }
    if (isAuthFailure(event, opened)) {
      this.setState('connecting');
      void this.refreshThenReconnect();
      return;
    }
    this.scheduleReconnect();
  }

  private async refreshThenReconnect(): Promise<void> {
    if (!this.refreshTask) this.refreshTask = this.pullConfig();
    try {
      await this.refreshTask;
    } finally {
      this.refreshTask = null;
    }
    if (!this.stopped) this.scheduleReconnect();
  }

  /** Gateway restarts drop in-memory browser tokens. The dev server re-registers. */
  private async pullConfig(): Promise<void> {
    try {
      const origin = globalThis.location?.origin;
      if (!origin || origin === 'null') return;
      const response = await fetch(new URL(DEVTOOLS_CONFIG_PATH, origin), { cache: 'no-store' });
      if (!response.ok) return;
      const body = (await response.json()) as { projectId?: unknown; browserToken?: unknown };
      if (typeof body.projectId !== 'string' || typeof body.browserToken !== 'string') return;
      if (!body.projectId || !body.browserToken) return;
      const next = workspaceSocketUrl(this.gatewayUrl, body.projectId, body.browserToken);
      if (next !== this.url) this.retryDelayMs = RECONNECT_MIN_MS;
      this.url = next;
    } catch {
      // Keep the current credentials and reconnect on the normal backoff.
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.retryTimer !== null) return;
    this.setState('connecting');
    const delay = this.retryDelayMs;
    this.retryDelayMs = Math.min(this.retryDelayMs * 2, RECONNECT_MAX_MS);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  private transmit(raw: string): void {
    if (this.socket && this.socket.readyState === 1) this.socket.send(raw);
    else this.outbound.push(raw);
  }

  private flush(): void {
    if (!this.socket || this.socket.readyState !== 1) return;
    for (const raw of this.outbound.splice(0)) this.socket.send(raw);
  }

  private handleIncoming(data: unknown): void {
    if (typeof data !== 'string') return;
    let payload: unknown;
    try {
      payload = JSON.parse(data);
    } catch {
      return;
    }
    const parsed = WorkspaceServerMessageSchema.safeParse(payload);
    if (!parsed.success) return;
    this.dispatch(parsed.data);
  }

  private dispatch(message: WorkspaceServerMessage): void {
    const handlers = this.listeners.get(message.type);
    if (handlers) {
      for (const handler of [...handlers]) {
        try {
          handler(message);
        } catch {
          // A subscriber must not break the socket.
        }
      }
    }
    if (!message.requestId) return;
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    if (message.type === 'error') {
      this.settle(message.requestId);
      pending.reject(new WorkspaceError(message.code, message.message));
      return;
    }
    if (message.type !== replyType(pending.type)) return;
    this.settle(message.requestId);
    pending.resolve(message);
  }

  private settle(requestId: string): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(requestId);
  }

  private failPending(error: Error): void {
    this.outbound.length = 0;
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timer);
      this.pending.delete(requestId);
      pending.reject(error);
    }
  }

  private setState(next: WorkspaceConnectionState): void {
    if (this.connectionState === next) return;
    this.connectionState = next;
    for (const listener of [...this.stateListeners]) {
      try {
        listener(next);
      } catch {
        // Ignore listener failures.
      }
    }
  }
}

function isAuthFailure(event: Event, opened: boolean): boolean {
  const code = readCloseCode(event);
  if (code === 4401 || code === 4403) return true;
  // A rejected HTTP upgrade never opens. Browsers report that as a close code (usually 1006).
  return !opened && code !== undefined;
}

function readCloseCode(event: Event): number | undefined {
  if (!event || typeof event !== 'object' || !('code' in event)) return undefined;
  const code = (event as { code?: unknown }).code;
  return typeof code === 'number' ? code : undefined;
}

export function workspaceSocketUrl(gatewayUrl: string, projectId: string, browserToken: string): string {
  const url = new URL(gatewayUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `/api/v1/projects/${encodeURIComponent(projectId)}/ws`;
  url.search = '';
  url.hash = '';
  url.searchParams.set('token', browserToken);
  return url.toString();
}

function replyType(type: WorkspaceClientMessage['type']): WorkspaceServerMessage['type'] | `${string}.result` {
  return type === 'run.start' ? 'run.accepted' : `${type}.result`;
}

function nextRequestId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return `req_${cryptoApi.randomUUID()}`;
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}
