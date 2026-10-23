import { spawn, type ChildProcess } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';
import {
  createStreamEvent,
  DEFAULT_PROCESS_TIMEOUT_MS,
  type UnifiedStreamEvent,
} from '@aidev/protocol';
import { CliAuthError, describeAuthFailure } from '../utils/binary.js';
import { logger } from '../utils/logger.js';
import { LineBuffer } from './stream.js';

export const DEFAULT_SIGKILL_GRACE_MS = 2_000;

export interface ManagedProcessOptions {
  sessionId: string;
  provider: string;
  command: string;
  args: string[];
  cwd: string;
  timeoutMs?: number;
  sigkillGraceMs?: number;
  env?: NodeJS.ProcessEnv;
  keepStdinOpen?: boolean;
  onEvent: (event: UnifiedStreamEvent) => void;
  parseStdoutLine?: (line: string, sessionId: string) => UnifiedStreamEvent[];
  parseStderrLine?: (line: string, sessionId: string) => UnifiedStreamEvent[];
}

export class ProcessTimeoutError extends Error {
  readonly sessionId: string;
  readonly timeoutMs: number;

  constructor(sessionId: string, timeoutMs: number) {
    super(`Session ${sessionId} timed out after ${timeoutMs}ms`);
    this.name = 'ProcessTimeoutError';
    this.sessionId = sessionId;
    this.timeoutMs = timeoutMs;
  }
}

export class ManagedProcess {
  readonly sessionId: string;
  readonly provider: string;
  private readonly command: string;
  private readonly args: string[];
  private readonly cwd: string;
  private readonly timeoutMs: number;
  private readonly sigkillGraceMs: number;
  private readonly env: NodeJS.ProcessEnv | undefined;
  private readonly keepStdinOpen: boolean;
  private readonly onEvent: (event: UnifiedStreamEvent) => void;
  private readonly parseStdoutLine: (line: string, sessionId: string) => UnifiedStreamEvent[];
  private readonly parseStderrLine: (line: string, sessionId: string) => UnifiedStreamEvent[];

  private child: ChildProcess | null = null;
  private timeoutTimer: NodeJS.Timeout | null = null;
  private sigkillTimer: NodeJS.Timeout | null = null;
  private forceTimer: NodeJS.Timeout | null = null;
  private startedAt = 0;
  private started = false;
  private settled = false;
  private timedOut = false;
  private pendingSignal: NodeJS.Signals | null = null;
  private readonly stdoutBuffer = new LineBuffer();
  private readonly stderrBuffer = new LineBuffer();
  private outputTail = '';
  private readonly stdoutDecoder = new StringDecoder('utf8');
  private readonly stderrDecoder = new StringDecoder('utf8');
  private readonly exitPromise: Promise<number>;
  private readonly resolveExit: (code: number) => void;
  private readonly rejectExit: (error: Error) => void;

  constructor(options: ManagedProcessOptions) {
    this.sessionId = options.sessionId;
    this.provider = options.provider;
    this.command = options.command;
    this.args = [...options.args];
    this.cwd = options.cwd;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_PROCESS_TIMEOUT_MS;
    this.sigkillGraceMs = options.sigkillGraceMs ?? DEFAULT_SIGKILL_GRACE_MS;
    this.env = options.env;
    this.keepStdinOpen = options.keepStdinOpen ?? false;
    this.onEvent = options.onEvent;
    this.parseStdoutLine = options.parseStdoutLine ?? defaultParseStdout;
    this.parseStderrLine = options.parseStderrLine ?? defaultParseStderr;

    let resolveExit: (code: number) => void = () => {};
    let rejectExit: (error: Error) => void = () => {};
    this.exitPromise = new Promise<number>((resolve, reject) => {
      resolveExit = resolve;
      rejectExit = reject;
    });
    this.resolveExit = resolveExit;
    this.rejectExit = rejectExit;
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  start(): Promise<number> {
    if (this.started) return this.exitPromise;
    this.started = true;
    this.startedAt = Date.now();
    void this.launch();
    return this.exitPromise;
  }

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    if (this.settled) return false;
    if (!this.child || this.child.pid == null || this.child.exitCode !== null) {
      this.pendingSignal = signal;
      return true;
    }
    return this.deliver(signal);
  }

  private async launch(): Promise<void> {
    if (!this.command) {
      this.fail(new Error('command is required'));
      return;
    }
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      this.fail(new Error('timeoutMs must be a positive number'));
      return;
    }
    try {
      const info = await stat(this.cwd);
      if (!info.isDirectory()) {
        this.fail(new Error(`cwd is not a directory: ${this.cwd}`));
        return;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.fail(new Error(`cwd does not exist: ${this.cwd}`));
        return;
      }
      this.fail(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    if (this.settled) return;

    // Arguments stay a discrete argv array (`shell: false`). On Unix the child
    // leads a new process group so SIGTERM/SIGKILL also reach grandchildren.
    const child = spawn(this.command, this.args, {
      cwd: this.cwd,
      env: {
        ...process.env,
        ...this.env,
        FORCE_COLOR: '0',
        CI: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      detached: process.platform !== 'win32',
      windowsHide: true,
    });
    this.child = child;
    // Closing the pipes after the child exits surfaces EPIPE. Those are expected.
    child.stdin?.on('error', () => {});
    child.stdout?.on('error', () => {});
    child.stderr?.on('error', () => {});
    if (!this.keepStdinOpen) child.stdin?.end();

    child.stdout?.on('data', (chunk: Buffer) => {
      this.emitLines(this.stdoutBuffer.push(this.stdoutDecoder.write(chunk)), this.parseStdoutLine);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      this.emitLines(this.stderrBuffer.push(this.stderrDecoder.write(chunk)), this.parseStderrLine);
    });

    child.on('close', (code, signal) => {
      this.handleClose(code, signal);
    });
    child.on('error', (error) => {
      this.fail(error);
    });

    this.timeoutTimer = setTimeout(() => {
      if (this.settled) return;
      this.timedOut = true;
      this.onEvent(
        createStreamEvent(this.sessionId, 'error', {
          error: `Session ${this.sessionId} timed out after ${this.timeoutMs}ms`,
        }),
      );
      logger.warn(`session ${this.sessionId} timed out after ${this.timeoutMs}ms`);
      this.kill('SIGTERM');
    }, this.timeoutMs);

    if (this.pendingSignal) {
      const signal = this.pendingSignal;
      this.pendingSignal = null;
      this.deliver(signal);
    }
  }

  private deliver(signal: NodeJS.Signals): boolean {
    const child = this.child;
    if (!child || child.pid == null || child.exitCode !== null) return false;
    const delivered = signalChild(child, signal);
    if (signal === 'SIGTERM' || signal === 'SIGINT') this.scheduleSigkill();
    return delivered;
  }

  private scheduleSigkill(): void {
    if (this.sigkillTimer) return;
    this.sigkillTimer = setTimeout(() => {
      if (this.settled || this.child?.exitCode !== null) return;
      logger.warn(`session ${this.sessionId} still running after SIGTERM; sending SIGKILL`);
      if (this.child) signalChild(this.child, 'SIGKILL');
      this.forceTimer = setTimeout(() => {
        if (!this.settled) {
          this.fail(new ProcessTimeoutError(this.sessionId, this.timeoutMs));
        }
      }, 500);
    }, this.sigkillGraceMs);
  }

  private handleClose(code: number | null, signal: NodeJS.Signals | null): void {
    this.emitLines(this.stdoutBuffer.push(this.stdoutDecoder.end()), this.parseStdoutLine);
    this.emitLines(this.stderrBuffer.push(this.stderrDecoder.end()), this.parseStderrLine);
    this.emitLines(this.stdoutBuffer.flush(), this.parseStdoutLine);
    this.emitLines(this.stderrBuffer.flush(), this.parseStderrLine);
    this.clearTimers();

    let authError: CliAuthError | undefined;
    if (!this.timedOut && code !== null && code !== 0) {
      const described = describeAuthFailure(this.provider, this.outputTail);
      if (described) {
        authError = new CliAuthError(this.provider, described.message, described.setup);
      }
      this.onEvent(
        createStreamEvent(this.sessionId, 'error', {
          error: authError?.message ?? `Process exited with code ${code}`,
        }),
      );
    }
    this.onEvent(
      createStreamEvent(this.sessionId, 'done', {
        durationMs: Math.max(0, Date.now() - this.startedAt),
      }),
    );

    if (this.settled) return;
    this.settled = true;
    if (authError) {
      this.rejectExit(authError);
      return;
    }
    if (this.timedOut) {
      this.rejectExit(new ProcessTimeoutError(this.sessionId, this.timeoutMs));
      return;
    }
    this.resolveExit(code ?? (signal ? 1 : 0));
  }

  private fail(error: Error): void {
    if (this.settled) return;
    this.settled = true;
    this.clearTimers();
    this.onEvent(createStreamEvent(this.sessionId, 'error', { error: error.message }));
    this.rejectExit(error);
  }

  private emitLines(
    lines: string[],
    parse: (line: string, sessionId: string) => UnifiedStreamEvent[],
  ): void {
    for (const line of lines) {
      this.noteOutput(line);
      let events: UnifiedStreamEvent[];
      try {
        events = parse(line, this.sessionId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.onEvent(createStreamEvent(this.sessionId, 'error', { error: message }));
        continue;
      }
      for (const event of events) this.onEvent(event);
    }
  }

  private noteOutput(line: string): void {
    if (!line) return;
    this.outputTail = `${this.outputTail}${line}\n`.slice(-8_000);
  }

  private clearTimers(): void {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
    if (this.sigkillTimer) {
      clearTimeout(this.sigkillTimer);
      this.sigkillTimer = null;
    }
    if (this.forceTimer) {
      clearTimeout(this.forceTimer);
      this.forceTimer = null;
    }
  }
}

function defaultParseStdout(line: string, sessionId: string): UnifiedStreamEvent[] {
  return [createStreamEvent(sessionId, 'chunk', { text: line })];
}

function defaultParseStderr(line: string, sessionId: string): UnifiedStreamEvent[] {
  return [createStreamEvent(sessionId, 'error', { error: line })];
}

function signalChild(child: ChildProcess, signal: NodeJS.Signals): boolean {
  const pid = child.pid;
  if (pid == null || child.exitCode !== null) return false;

  if (process.platform !== 'win32') {
    try {
      process.kill(-pid, signal);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      logger.debug(`process group ${signal} for ${pid} failed: ${code ?? 'unknown'}`);
    }
  }

  try {
    return child.kill(signal);
  } catch {
    return false;
  }
}
