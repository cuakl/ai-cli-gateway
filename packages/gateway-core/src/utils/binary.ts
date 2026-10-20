import { execFile } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ProviderTypeSchema, type ProviderType } from '@gateway/shared-types';

export interface ResolveTarget {
  commands: string[];
  paths: string[];
}

export type ProviderCandidates = Record<ProviderType, ResolveTarget>;

/** Command names passed to `which`. Rejects anything a shell could interpret. */
const COMMAND_NAME = /^[A-Za-z0-9._+-]+$/;

export interface BinaryResolverOptions {
  which?: (command: string) => Promise<string | null>;
  isExecutable?: (filePath: string) => Promise<boolean>;
  candidates?: Partial<ProviderCandidates>;
  home?: string;
}

export function defaultProviderCandidates(home: string = homedir()): ProviderCandidates {
  return {
    cursor: {
      commands: ['agent', 'cursor-agent', 'cursor'],
      paths: [
        join(home, '.cursor', 'bin', 'agent'),
        join(home, '.local', 'bin', 'agent'),
        '/usr/local/bin/agent',
        '/opt/homebrew/bin/agent',
        join(home, '.cursor', 'bin', 'cursor'),
        '/usr/local/bin/cursor',
        '/opt/homebrew/bin/cursor',
      ],
    },
    antigravity: {
      commands: ['agy'],
      paths: [
        join(home, '.local', 'bin', 'agy'),
        join(home, '.antigravity', 'bin', 'agy'),
        '/usr/local/bin/agy',
        '/opt/homebrew/bin/agy',
      ],
    },
    claude: {
      commands: ['claude'],
      paths: [
        join(home, '.local', 'bin', 'claude'),
        join(home, '.claude', 'local', 'claude'),
        '/usr/local/bin/claude',
        '/opt/homebrew/bin/claude',
      ],
    },
    codex: {
      commands: ['codex'],
      paths: [
        join(home, '.local', 'bin', 'codex'),
        join(home, '.npm-global', 'bin', 'codex'),
        '/usr/local/bin/codex',
        '/opt/homebrew/bin/codex',
      ],
    },
  };
}

export class BinaryNotFoundError extends Error {
  readonly provider: ProviderType;

  constructor(provider: ProviderType) {
    super(missingBinaryMessage(provider));
    this.name = 'BinaryNotFoundError';
    this.provider = provider;
  }
}

export class BinaryResolver {
  private readonly whichImpl: (command: string) => Promise<string | null>;
  private readonly isExecutableImpl: (filePath: string) => Promise<boolean>;
  private readonly candidates: ProviderCandidates;

  constructor(options: BinaryResolverOptions = {}) {
    this.whichImpl = options.which ?? whichCommand;
    this.isExecutableImpl = options.isExecutable ?? isExecutable;
    const defaults = defaultProviderCandidates(options.home);
    this.candidates = {
      cursor: options.candidates?.cursor ?? defaults.cursor,
      antigravity: options.candidates?.antigravity ?? defaults.antigravity,
      claude: options.candidates?.claude ?? defaults.claude,
      codex: options.candidates?.codex ?? defaults.codex,
    };
  }

  candidatesFor(provider: ProviderType): ResolveTarget {
    return this.targetFor(provider);
  }

  async which(command: string): Promise<string | null> {
    if (!COMMAND_NAME.test(command)) return null;
    const found = (await this.whichImpl(command))?.trim();
    if (!found) return null;
    return (await this.isExecutableImpl(found)) ? found : null;
  }

  async resolve(provider: ProviderType): Promise<string | null> {
    const target = this.targetFor(provider);
    for (const command of target.commands) {
      const found = await this.which(command);
      if (found) return found;
    }
    for (const filePath of target.paths) {
      if (await this.isExecutableImpl(filePath)) return filePath;
    }
    return null;
  }

  async isAvailable(provider: ProviderType): Promise<boolean> {
    return (await this.resolve(provider)) !== null;
  }

  async detectAll(): Promise<Record<ProviderType, string | null>> {
    const detected = {} as Record<ProviderType, string | null>;
    await Promise.all(
      ProviderTypeSchema.options.map(async (provider) => {
        detected[provider] = await this.resolve(provider);
      }),
    );
    return detected;
  }

  private targetFor(provider: ProviderType): ResolveTarget {
    const target = this.candidates[provider];
    if (!target) {
      throw new Error(`No binary candidates configured for ${provider}`);
    }
    return target;
  }
}

export function whichCommand(command: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('which', [command], { timeout: 5_000, encoding: 'utf8' }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      const line = stdout
        .split('\n')
        .map((entry) => entry.trim())
        .find((entry) => entry.length > 0);
      resolve(line ?? null);
    });
  });
}

export async function isExecutable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function missingBinaryMessage(provider: ProviderType): string {
  switch (provider) {
    case 'cursor':
      return 'Cursor CLI (`agent`) was not found. Install the Cursor CLI and ensure `agent` is on PATH or at ~/.cursor/bin/agent.';
    case 'antigravity':
      return 'Antigravity CLI (`agy`) was not found. Install it and ensure `agy` is on PATH.';
    case 'claude':
      return 'Claude Code (`claude`) was not found. Install Claude Code and ensure `claude` is on PATH.';
    case 'codex':
      return 'Codex CLI (`codex`) was not found. Install it and ensure `codex` is on PATH.';
    default: {
      const exhaustive: never = provider;
      return `CLI for provider "${exhaustive}" was not found.`;
    }
  }
}
