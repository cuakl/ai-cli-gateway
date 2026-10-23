import type { CLIAdapter } from '@aidev/adapters';
import type { ProviderType, SessionRecord, SessionStatus, UnifiedStreamEvent } from '@aidev/protocol';

/** Finished sessions stay queryable long enough for a late SSE client to replay them. */
export const DEFAULT_SESSION_TTL_MS = 10 * 60 * 1000;

const TERMINAL_STATUSES = new Set<SessionStatus>(['completed', 'failed', 'killed', 'timed_out']);

export function isTerminalStatus(status: SessionStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export interface SessionRegistryOptions {
  /** How long a finished session stays in memory. Defaults to 10 minutes. */
  ttlMs?: number;
  /**
   * Keep only the most recent events when set.
   * Leave unset to retain every event, so a subscriber never misses `init`.
   */
  maxEvents?: number;
  now?: () => number;
}

export interface CreateSessionInput {
  id: string;
  provider: ProviderType;
  cwd: string;
  adapter: CLIAdapter;
  ephemeral?: boolean;
}

export interface FinishSessionInput {
  status: SessionStatus;
  exitCode?: number;
}

export interface SessionSubscription {
  /** Events already buffered at subscribe time, in order. */
  events: UnifiedStreamEvent[];
  unsubscribe: () => void;
}

interface LiveSession {
  record: SessionRecord;
  events: UnifiedStreamEvent[];
  listeners: Set<(event: UnifiedStreamEvent) => void>;
  adapter: CLIAdapter;
  cleanupTimer?: NodeJS.Timeout;
}

/**
 * In-memory sessions plus a per-session event buffer.
 * `subscribe` snapshots the buffer and then receives live events, so an SSE
 * client that connects just after `POST /sessions` still sees `init` and any
 * chunks emitted before the response was read.
 */
export class SessionRegistry {
  private readonly sessions = new Map<string, LiveSession>();
  private readonly ttlMs: number;
  private readonly maxEvents: number | undefined;
  private readonly now: () => number;

  constructor(options: SessionRegistryOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_SESSION_TTL_MS;
    if (!Number.isFinite(this.ttlMs) || this.ttlMs <= 0) {
      throw new Error('ttlMs must be a positive number');
    }
    if (
      options.maxEvents !== undefined &&
      (!Number.isInteger(options.maxEvents) || options.maxEvents < 1)
    ) {
      throw new Error('maxEvents must be a positive integer');
    }
    this.maxEvents = options.maxEvents;
    this.now = options.now ?? Date.now;
  }

  create(input: CreateSessionInput): SessionRecord {
    if (!input.id) throw new Error('session id is required');
    if (this.sessions.has(input.id)) {
      throw new Error(`Session ${input.id} already exists`);
    }
    const timestamp = this.now();
    const record: SessionRecord = {
      id: input.id,
      provider: input.provider,
      cwd: input.cwd,
      status: 'running',
      createdAt: timestamp,
      updatedAt: timestamp,
      ...(input.ephemeral !== undefined ? { ephemeral: input.ephemeral } : {}),
    };
    this.sessions.set(input.id, {
      record,
      events: [],
      listeners: new Set(),
      adapter: input.adapter,
    });
    return { ...record };
  }

  get(id: string): SessionRecord | undefined {
    const session = this.sessions.get(id);
    return session ? { ...session.record } : undefined;
  }

  events(id: string): UnifiedStreamEvent[] | undefined {
    const session = this.sessions.get(id);
    return session ? [...session.events] : undefined;
  }

  adapterFor(id: string): CLIAdapter | undefined {
    return this.sessions.get(id)?.adapter;
  }

  append(id: string, event: UnifiedStreamEvent): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.events.push(event);
    if (this.maxEvents !== undefined && session.events.length > this.maxEvents) {
      session.events.splice(0, session.events.length - this.maxEvents);
    }
    session.record = { ...session.record, updatedAt: this.now() };
    for (const listener of [...session.listeners]) {
      try {
        listener(event);
      } catch {
        // One broken subscriber must not drop events for the others.
      }
    }
  }

  /**
   * Copy the buffer and attach `listener` for later events.
   * Both steps are synchronous, so nothing emitted on this turn is lost or duplicated.
   */
  subscribe(
    id: string,
    listener: (event: UnifiedStreamEvent) => void,
  ): SessionSubscription | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    const events = [...session.events];
    session.listeners.add(listener);
    return {
      events,
      unsubscribe: () => {
        session.listeners.delete(listener);
      },
    };
  }

  /**
   * Record a terminal status. A session already marked `killed` stays killed
   * so the process exit that follows DELETE cannot overwrite it with `failed`.
   */
  finish(id: string, update: FinishSessionInput): SessionRecord | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    const wasTerminal = isTerminalStatus(session.record.status);
    const status: SessionStatus = session.record.status === 'killed' ? 'killed' : update.status;
    session.record = {
      ...session.record,
      status,
      updatedAt: this.now(),
      ...(update.exitCode !== undefined ? { exitCode: update.exitCode } : {}),
    };
    if (!wasTerminal && isTerminalStatus(status)) this.scheduleCleanup(session);
    return { ...session.record };
  }

  /** Mark a running session killed. Finished sessions keep their status. */
  markKilled(id: string): SessionRecord | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    if (session.record.status !== 'running' && session.record.status !== 'pending') {
      return { ...session.record };
    }
    session.record = { ...session.record, status: 'killed', updatedAt: this.now() };
    this.scheduleCleanup(session);
    return { ...session.record };
  }

  /** Drop timers and signal any child that is still running. */
  dispose(): void {
    const sessions = [...this.sessions.values()];
    for (const session of sessions) {
      if (session.cleanupTimer) clearTimeout(session.cleanupTimer);
      session.listeners.clear();
    }
    this.sessions.clear();
    for (const session of sessions) {
      if (session.record.status === 'running' || session.record.status === 'pending') {
        void session.adapter.kill(session.record.id).catch(() => undefined);
      }
    }
  }

  private scheduleCleanup(session: LiveSession): void {
    if (session.cleanupTimer) return;
    session.cleanupTimer = setTimeout(() => {
      this.sessions.delete(session.record.id);
    }, this.ttlMs);
    session.cleanupTimer.unref();
  }
}
