import { execFile } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ProviderTypeSchema, type ProviderType } from '@aidev/protocol';

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
      commands: ['agent', 'cursor-agent'],
      paths: [
        join(home, '.local', 'bin', 'agent'),
        join(home, '.local', 'bin', 'cursor-agent'),
        join(home, '.cursor', 'bin', 'agent'),
        join(home, '.cursor', 'bin', 'cursor-agent'),
        '/usr/local/bin/agent',
        '/usr/local/bin/cursor-agent',
        '/opt/homebrew/bin/agent',
        '/opt/homebrew/bin/cursor-agent',
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
  readonly setup: string[];

  constructor(provider: ProviderType) {
    const setup = providerSetup(provider);
    super(formatWithSteps(missingBinaryIntro(provider), setup));
    this.name = 'BinaryNotFoundError';
    this.provider = provider;
    this.setup = setup;
  }
}

export class CliAuthError extends Error {
  readonly provider: string;
  readonly setup: string[];

  constructor(provider: string, message: string, setup: string[]) {
    super(message);
    this.name = 'CliAuthError';
    this.provider = provider;
    this.setup = setup;
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

const AUTH_FAILURE =
  /\b(unauthori[sz]ed|not authenticated|unauthenticated|authentication required|authentication_failed|failed to authenticate|please (log|sign) in|log in required|login required|not logged in|sign in required|invalid api key|missing api key|access token has expired|oauth token has expired|token has expired|re-authenticate)\b/i;

export function providerSetup(provider: ProviderType): string[] {
  switch (provider) {
    case 'cursor':
      return [
        'Install the Cursor CLI so `agent` is on PATH (usually ~/.cursor/bin or ~/.local/bin).',
        'Run `agent` in a terminal and finish sign-in.',
      ];
    case 'antigravity':
      return ['Install the Antigravity CLI so `agy` is on PATH.', 'Run `agy` and finish sign-in.'];
    case 'claude':
      return ['Install Claude Code so `claude` is on PATH.', 'Run `claude` and complete login.'];
    case 'codex':
      return ['Install the Codex CLI so `codex` is on PATH.', 'Run `codex` and finish sign-in.'];
    default: {
      const exhaustive: never = provider;
      return [`Install the CLI for "${exhaustive}" and complete its login.`];
    }
  }
}

/**
 * Turn CLI output that asks for login into a structured error.
 * Ordinary failures (compile errors, non-zero exits) return null.
 */
export function describeAuthFailure(
  provider: string,
  output: string,
): { message: string; setup: string[] } | null {
  if (!AUTH_FAILURE.test(output)) return null;
  const known = ProviderTypeSchema.safeParse(provider);
  const setup = known.success
    ? providerAuthSetup(known.data)
    : ['Sign in with the CLI, then retry.'];
  const label = known.success ? providerLabel(known.data) : provider;
  return { message: formatWithSteps(`${label} is not authenticated.`, setup), setup };
}

function missingBinaryIntro(provider: ProviderType): string {
  switch (provider) {
    case 'cursor':
      return 'Cursor CLI (`agent`) was not found.';
    case 'antigravity':
      return 'Antigravity CLI (`agy`) was not found.';
    case 'claude':
      return 'Claude Code (`claude`) was not found.';
    case 'codex':
      return 'Codex CLI (`codex`) was not found.';
    default: {
      const exhaustive: never = provider;
      return `CLI for provider "${exhaustive}" was not found.`;
    }
  }
}

function providerAuthSetup(provider: ProviderType): string[] {
  switch (provider) {
    case 'cursor':
      return ['Run `agent login` and finish sign-in in the browser.'];
    case 'antigravity':
      return ['Run `agy` and finish sign-in.'];
    case 'claude':
      return ['Run `claude` and complete login.'];
    case 'codex':
      return ['Run `codex` and finish sign-in.'];
    default: {
      const exhaustive: never = provider;
      return [`Sign in to the CLI for "${exhaustive}", then retry.`];
    }
  }
}

function providerLabel(provider: ProviderType): string {
  switch (provider) {
    case 'cursor':
      return 'Cursor CLI (`agent`)';
    case 'antigravity':
      return 'Antigravity CLI (`agy`)';
    case 'claude':
      return 'Claude Code (`claude`)';
    case 'codex':
      return 'Codex CLI (`codex`)';
    default: {
      const exhaustive: never = provider;
      return exhaustive;
    }
  }
}

function formatWithSteps(intro: string, steps: string[]): string {
  const numbered = steps.map((step, index) => `${index + 1}. ${step}`).join('\n');
  return `${intro}\n${numbered}`;
}
