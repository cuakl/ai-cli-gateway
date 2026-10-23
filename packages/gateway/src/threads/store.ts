import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import path from 'node:path';
import { logger } from '@aidev/adapters';
import {
  RunSchema,
  ThreadEventSchema,
  ThreadSchema,
  type Provider,
  type Run,
  type RunMode,
  type Thread,
  type ThreadEvent,
  type ThreadSource,
  type UnifiedStreamEvent,
} from '@aidev/protocol';
import { z } from 'zod';
import { newThreadId } from './run.js';

const ThreadFileSchema = z.object({
  thread: ThreadSchema,
  runs: z.array(RunSchema),
});

type ThreadFile = z.infer<typeof ThreadFileSchema>;

export interface ListThreadsQuery {
  projectId?: string;
  source?: ThreadSource;
  limit?: number;
}

export interface CreateThreadInput {
  projectId: string | null;
  provider: Provider;
  model: string | null;
  mode: RunMode;
  title: string;
  keep: boolean;
  source: ThreadSource;
}

/** Fields `updateThread` may change. `id` and `createdAt` stay put. */
export interface ThreadPatch {
  projectId?: string | null;
  provider?: Provider;
  model?: string | null;
  mode?: RunMode;
  providerSessionId?: string | null;
  title?: string;
  keep?: boolean;
  source?: ThreadSource;
}

export class ThreadStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ThreadStoreError';
  }
}

/**
 * Thread metadata and append-only events.
 * A later SQLite store can implement the same methods.
 */
export interface ThreadStore {
  createThread(input: CreateThreadInput): Promise<Thread>;
  /** Thread plus its runs, or `undefined` when the file is absent. */
  getThread(threadId: string): Promise<{ thread: Thread; runs: Run[] } | undefined>;
  /** Scan thread files for a run id. */
  findRun(runId: string): Promise<{ thread: Thread; run: Run } | undefined>;
  /** Newest `updatedAt` first. */
  listThreads(query: ListThreadsQuery): Promise<Thread[]>;
  /**
   * Append one JSONL line. The write finishes before this method returns,
   * so callers can broadcast the event only after it is durable.
   */
  appendEvent(threadId: string, runId: string, event: UnifiedStreamEvent): Promise<void>;
  /** Insert the run, or replace the run with the same id. */
  updateRun(threadId: string, run: Run): Promise<Run>;
  updateThread(threadId: string, patch: ThreadPatch): Promise<Thread>;
  /** Remove the metadata file and the event log. */
  deleteThread(threadId: string): Promise<boolean>;
  readEvents(threadId: string, runId?: string): Promise<ThreadEvent[]>;
  /** Delete `keep: false` threads whose `updatedAt` is older than `retentionDays`. */
  purgeExpired(retentionDays: number, now?: number): Promise<string[]>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `$AIDEV_HOME/threads/<threadId>.json` is `{ thread, runs }`, replaced by
 * writing a temp file in the same directory and renaming it.
 * `$AIDEV_HOME/threads/<threadId>.jsonl` is one `{ runId, event }` per line.
 */
export class FileThreadStore implements ThreadStore {
  private readonly directory: string;

  constructor(home: string) {
    this.directory = path.join(home, 'threads');
  }

  createThread(input: CreateThreadInput): Promise<Thread> {
    this.ensureDir();
    const timestamp = Date.now();
    const thread = ThreadSchema.parse({
      id: this.allocateId(),
      projectId: input.projectId,
      provider: input.provider,
      model: input.model,
      mode: input.mode,
      providerSessionId: null,
      title: input.title,
      createdAt: timestamp,
      updatedAt: timestamp,
      keep: input.keep,
      source: input.source,
    });
    this.writeSync({ thread, runs: [] });
    return Promise.resolve(thread);
  }

  getThread(threadId: string): Promise<{ thread: Thread; runs: Run[] } | undefined> {
    return Promise.resolve(this.readSync(threadId));
  }

  findRun(runId: string): Promise<{ thread: Thread; run: Run } | undefined> {
    if (!/^run_[A-Za-z0-9_-]+$/.test(runId)) return Promise.resolve(undefined);
    for (const id of this.threadIds()) {
      try {
        const record = this.readSync(id);
        const run = record?.runs.find((item) => item.id === runId);
        if (record && run) return Promise.resolve({ thread: record.thread, run });
      } catch (error) {
        if (!(error instanceof ThreadStoreError)) throw error;
        logger.error(error.message);
      }
    }
    return Promise.resolve(undefined);
  }

  listThreads(query: ListThreadsQuery): Promise<Thread[]> {
    const threads: Thread[] = [];
    for (const id of this.threadIds()) {
      try {
        const record = this.readSync(id);
        if (!record) continue;
        if (query.projectId !== undefined && record.thread.projectId !== query.projectId) continue;
        if (query.source !== undefined && record.thread.source !== query.source) continue;
        threads.push(record.thread);
      } catch (error) {
        if (!(error instanceof ThreadStoreError)) throw error;
        logger.error(error.message);
      }
    }
    threads.sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
    if (query.limit !== undefined) return Promise.resolve(threads.slice(0, query.limit));
    return Promise.resolve(threads);
  }

  appendEvent(threadId: string, runId: string, event: UnifiedStreamEvent): Promise<void> {
    this.appendEventSync(threadId, runId, event);
    return Promise.resolve();
  }

  updateRun(threadId: string, run: Run): Promise<Run> {
    const parsed = RunSchema.parse(run);
    if (parsed.threadId !== threadId) {
      throw new ThreadStoreError(`Run ${parsed.id} does not belong to thread ${threadId}`);
    }
    const saved = this.mutate(threadId, (current) => {
      const index = current.runs.findIndex((item) => item.id === parsed.id);
      if (index === -1) current.runs.push(parsed);
      else current.runs[index] = parsed;
    });
    const stored = saved.runs.find((item) => item.id === parsed.id);
    if (!stored) throw new ThreadStoreError(`Run ${parsed.id} was not saved`);
    return Promise.resolve(stored);
  }

  updateThread(threadId: string, patch: ThreadPatch): Promise<Thread> {
    const saved = this.mutate(threadId, (current) => {
      const thread = current.thread;
      if (patch.projectId !== undefined) thread.projectId = patch.projectId;
      if (patch.provider !== undefined) thread.provider = patch.provider;
      if (patch.model !== undefined) thread.model = patch.model;
      if (patch.mode !== undefined) thread.mode = patch.mode;
      if (patch.providerSessionId !== undefined) thread.providerSessionId = patch.providerSessionId;
      if (patch.title !== undefined) thread.title = patch.title;
      if (patch.keep !== undefined) thread.keep = patch.keep;
      if (patch.source !== undefined) thread.source = patch.source;
    });
    return Promise.resolve(saved.thread);
  }

  deleteThread(threadId: string): Promise<boolean> {
    return Promise.resolve(this.deleteSync(threadId));
  }

  readEvents(threadId: string, runId?: string): Promise<ThreadEvent[]> {
    this.assertId(threadId);
    const file = this.jsonlPath(threadId);
    if (!existsSync(file)) return Promise.resolve([]);
    const raw = readFileSync(file, 'utf8');
    const events: ThreadEvent[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const parsed = ThreadEventSchema.parse(JSON.parse(line) as unknown);
        if (runId !== undefined && parsed.runId !== runId) continue;
        events.push(parsed);
      } catch {
        // A crash can leave a partial last line. Skip it.
      }
    }
    return Promise.resolve(events);
  }

  purgeExpired(retentionDays: number, now = Date.now()): Promise<string[]> {
    if (!Number.isInteger(retentionDays) || retentionDays < 1) {
      throw new ThreadStoreError('retentionDays must be a positive integer');
    }
    const cutoff = now - retentionDays * DAY_MS;
    const removed: string[] = [];
    for (const thread of this.listSync()) {
      if (thread.keep || thread.updatedAt >= cutoff) continue;
      if (this.deleteSync(thread.id)) removed.push(thread.id);
    }
    return Promise.resolve(removed);
  }

  private listSync(): Thread[] {
    const threads: Thread[] = [];
    for (const id of this.threadIds()) {
      try {
        const record = this.readSync(id);
        if (record) threads.push(record.thread);
      } catch (error) {
        if (!(error instanceof ThreadStoreError)) throw error;
        logger.error(error.message);
      }
    }
    return threads;
  }

  private appendEventSync(threadId: string, runId: string, event: UnifiedStreamEvent): void {
    this.assertId(threadId);
    if (!/^run_[A-Za-z0-9_-]+$/.test(runId)) {
      throw new ThreadStoreError(`Invalid run id ${runId}`);
    }
    if (!existsSync(this.jsonPath(threadId))) {
      throw new ThreadStoreError(`Thread ${threadId} was not found`);
    }
    const line = ThreadEventSchema.parse({ runId, event });
    this.ensureDir();
    const fd = openSync(this.jsonlPath(threadId), 'a', 0o600);
    try {
      writeSync(fd, `${JSON.stringify(line)}\n`);
    } finally {
      closeSync(fd);
    }
  }

  private mutate(threadId: string, change: (current: ThreadFile) => void): ThreadFile {
    const current = this.readSync(threadId);
    if (!current) throw new ThreadStoreError(`Thread ${threadId} was not found`);
    const next: ThreadFile = {
      thread: { ...current.thread },
      runs: current.runs.map((run) => ({ ...run })),
    };
    change(next);
    next.thread.updatedAt = Date.now();
    const parsed = ThreadFileSchema.parse(next);
    this.writeSync(parsed);
    return parsed;
  }

  private readSync(threadId: string): ThreadFile | undefined {
    this.assertId(threadId);
    const file = this.jsonPath(threadId);
    if (!existsSync(file)) return undefined;
    let raw: string;
    try {
      raw = readFileSync(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      throw new ThreadStoreError(`Invalid JSON in thread ${threadId}`);
    }
    const result = ThreadFileSchema.safeParse(parsed);
    if (!result.success) throw new ThreadStoreError(`Invalid thread file ${threadId}`);
    return result.data;
  }

  private writeSync(record: ThreadFile): void {
    const parsed = ThreadFileSchema.parse(record);
    this.ensureDir();
    const file = this.jsonPath(parsed.thread.id);
    const tmp = path.join(this.directory, `.${parsed.thread.id}.${process.pid}.${Date.now()}.tmp`);
    try {
      writeFileSync(tmp, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 });
      renameSync(tmp, file);
    } catch (error) {
      try {
        unlinkSync(tmp);
      } catch {
        // The temp file may already have been renamed.
      }
      throw error;
    }
  }

  private deleteSync(threadId: string): boolean {
    this.assertId(threadId);
    const json = this.jsonPath(threadId);
    const jsonl = this.jsonlPath(threadId);
    const hadJson = existsSync(json);
    const hadJsonl = existsSync(jsonl);
    if (hadJson) unlinkSync(json);
    if (hadJsonl) unlinkSync(jsonl);
    return hadJson || hadJsonl;
  }

  private threadIds(): string[] {
    let names: string[];
    try {
      names = readdirSync(this.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const ids: string[] = [];
    for (const name of names) {
      if (!name.endsWith('.json') || name.startsWith('.')) continue;
      const id = name.slice(0, -'.json'.length);
      if (/^thr_[A-Za-z0-9_-]+$/.test(id)) ids.push(id);
    }
    return ids;
  }

  private allocateId(): string {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const id = newThreadId();
      if (!existsSync(this.jsonPath(id))) return id;
    }
    throw new ThreadStoreError('Could not allocate a thread id');
  }

  private ensureDir(): void {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
  }

  private jsonPath(threadId: string): string {
    return this.pathFor(threadId, '.json');
  }

  private jsonlPath(threadId: string): string {
    return this.pathFor(threadId, '.jsonl');
  }

  private pathFor(threadId: string, ext: '.json' | '.jsonl'): string {
    this.assertId(threadId);
    return path.join(this.directory, `${threadId}${ext}`);
  }

  private assertId(threadId: string): void {
    if (!/^thr_[A-Za-z0-9_-]+$/.test(threadId)) {
      throw new ThreadStoreError(`Invalid thread id ${threadId}`);
    }
  }
}
