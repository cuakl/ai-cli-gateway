import { randomUUID } from 'node:crypto';
import {
  createStreamEvent,
  PromptOptionsSchema,
  type PromptOptions,
  type ProviderType,
  type UnifiedStreamEvent,
} from '@gateway/shared-types';
import { ProcessManager } from '../session/manager.js';
import type { CLIAdapter, ExecuteResult } from '../types/adapter.js';
import { BinaryNotFoundError, BinaryResolver } from '../utils/binary.js';

/**
 * Shared execution flow for CLI providers. Subclasses build argv and, when
 * the provider's stdout is not plain text, override the line parsers.
 * `execute` resolves for any process exit, including non-zero codes. It
 * rejects when the binary is missing, cwd is unusable, or the watchdog fires.
 */
export abstract class BaseAdapter implements CLIAdapter {
  abstract readonly provider: ProviderType;

  constructor(
    protected readonly binaries: BinaryResolver = new BinaryResolver(),
    protected readonly processes: ProcessManager = new ProcessManager(),
  ) {}

  async isAvailable(): Promise<boolean> {
    return this.binaries.isAvailable(this.provider);
  }

  async getBinaryPath(): Promise<string> {
    const binaryPath = await this.binaries.resolve(this.provider);
    if (!binaryPath) throw new BinaryNotFoundError(this.provider);
    return binaryPath;
  }

  abstract buildArgs(options: PromptOptions): string[];

  protected parseStdoutLine(line: string, sessionId: string): UnifiedStreamEvent[] {
    return [createStreamEvent(sessionId, 'chunk', { text: line })];
  }

  protected parseStderrLine(line: string, sessionId: string): UnifiedStreamEvent[] {
    return [createStreamEvent(sessionId, 'error', { error: line })];
  }

  async execute(
    options: PromptOptions,
    onEvent: (event: UnifiedStreamEvent) => void,
  ): Promise<ExecuteResult> {
    const parsed = PromptOptionsSchema.parse(options);
    const command = await this.getBinaryPath();
    const sessionId = parsed.sessionId ?? randomUUID();
    const args = this.buildArgs(parsed);
    const chunks: string[] = [];

    onEvent(
      createStreamEvent(sessionId, 'init', {
        text: `${this.provider} session started`,
      }),
    );

    const exitCode = await this.processes.start({
      sessionId,
      provider: this.provider,
      command,
      args,
      cwd: parsed.cwd,
      ...(parsed.timeoutMs !== undefined ? { timeoutMs: parsed.timeoutMs } : {}),
      onEvent: (event) => {
        if (event.type === 'chunk' && event.payload.text) chunks.push(event.payload.text);
        onEvent(event);
      },
      parseStdoutLine: (line, id) => this.parseStdoutLine(line, id),
      parseStderrLine: (line, id) => this.parseStderrLine(line, id),
    });

    return { exitCode, summary: chunks.join('') };
  }

  async kill(sessionId: string): Promise<boolean> {
    return this.processes.kill(sessionId);
  }
}
