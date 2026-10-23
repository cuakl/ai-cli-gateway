import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { PromptOptions, ProviderCapabilities, UnifiedStreamEvent } from '@aidev/protocol';
import { beforeAll, describe, expect, it, type TestContext } from 'vitest';
import {
  createAdapter,
  describeAuthFailure,
  getProviderCapabilities,
  helpIncludesFlag,
  type CLIAdapter,
  type ExecuteResult,
} from '../../src/index.js';
import { collectEvents } from '../adapters/helpers.js';

const execFileAsync = promisify(execFile);
const LIVE = process.env.AIDEV_LIVE === '1';
const PROVIDERS = ['cursor', 'antigravity', 'claude', 'codex'] as const;
const ASK_TIMEOUT_MS = 180_000;
const REMEMBER = 'glimmeroak';

describe.skipIf(!LIVE)('live CLI contracts', () => {
  let listed: ProviderCapabilities[] = [];

  beforeAll(async () => {
    listed = await getProviderCapabilities();
  }, 90_000);

  for (const provider of PROVIDERS) {
    describe(provider, () => {
      function ready(ctx: TestContext): ProviderCapabilities & { binaryPath: string } {
        const item = listed.find((entry) => entry.provider === provider);
        const binaryPath = item?.binaryPath ?? null;
        if (!item || !item.available || !item.verified || binaryPath === null) {
          ctx.skip(`${provider} is not an available verified provider`);
          throw new Error(`${provider} is not an available verified provider`);
        }
        return { ...item, binaryPath };
      }

      it('only emits flags listed in --help', async (ctx) => {
        const item = ready(ctx);
        const adapter = createAdapter(provider);
        const help = await cliHelp(item.binaryPath);
        const missing = emittedFlags(adapter).filter((flag) => !helpIncludesFlag(help, flag));
        expect(missing, `missing from ${item.binaryPath} --help`).toEqual([]);
      }, 30_000);

      it('ask mode replies OK with one session and one done', async (ctx) => {
        ready(ctx);
        const cwd = await tempDir('aidev-live-ask-');
        try {
          const { events } = await runLive(ctx, createAdapter(provider), {
            prompt: 'Reply with exactly: OK',
            cwd,
            mode: 'ask',
          });
          const chunks = events.filter((event) => event.type === 'chunk').map((event) => event.payload.text ?? '');
          expect(chunks.some((text) => text.includes('OK')), chunks.join('|')).toBe(true);
          expect(events.filter((event) => event.type === 'session_info')).toHaveLength(1);
          expect(events.filter((event) => event.type === 'done')).toHaveLength(1);
        } finally {
          await rm(cwd, { recursive: true, force: true });
        }
      });

      it('resume recalls a word from the previous turn', async (ctx) => {
        ready(ctx);
        const cwd = await tempDir('aidev-live-resume-');
        const adapter = createAdapter(provider);
        try {
          const first = await runLive(ctx, adapter, {
            prompt: `Remember the word ${REMEMBER}. Reply with exactly: OK`,
            cwd,
            mode: 'ask',
          });
          const providerSessionId = first.events.find((event) => event.type === 'session_info')?.payload
            .providerSessionId;
          expect(providerSessionId, 'session_info.providerSessionId').toEqual(expect.any(String));
          if (!providerSessionId) return;
          const second = await runLive(ctx, adapter, {
            prompt: 'What word did I ask you to remember? Reply with only that word.',
            cwd,
            mode: 'ask',
            providerSessionId,
          });
          const text = second.events
            .filter((event) => event.type === 'chunk')
            .map((event) => event.payload.text ?? '')
            .join('');
          expect(text, text).toContain(REMEMBER);
        } finally {
          await rm(cwd, { recursive: true, force: true });
        }
      });

      it('agent mode creates hello.txt in a temp git repo', async (ctx) => {
        ready(ctx);
        const cwd = await tempDir('aidev-live-agent-');
        try {
          await execFileAsync('git', ['init'], { cwd });
          await execFileAsync('git', ['config', 'user.email', 'aidev@example.com'], { cwd });
          await execFileAsync('git', ['config', 'user.name', 'aidev'], { cwd });
          await execFileAsync('git', ['config', 'commit.gpgsign', 'false'], { cwd });
          await writeFile(path.join(cwd, 'README.md'), 'temp\n');
          await execFileAsync('git', ['add', 'README.md'], { cwd });
          await execFileAsync('git', ['commit', '-m', 'init'], { cwd });
          await runLive(ctx, createAdapter(provider), {
            prompt: 'Create hello.txt containing hi',
            cwd,
            mode: 'agent',
          });
          const body = await readFile(path.join(cwd, 'hello.txt'), 'utf8');
          expect(body).toContain('hi');
        } finally {
          await rm(cwd, { recursive: true, force: true });
        }
      });
    });
  }
});

async function runLive(
  ctx: TestContext,
  adapter: CLIAdapter,
  options: PromptOptions,
): Promise<{ events: UnifiedStreamEvent[]; result: ExecuteResult }> {
  const collected = collectEvents();
  try {
    const result = await adapter.execute({ timeoutMs: ASK_TIMEOUT_MS, ...options }, collected.onEvent);
    const reason = authReason(adapter.provider, undefined, collected.events);
    const chunks = collected.events.filter((event) => event.type === 'chunk').map((event) => event.payload.text ?? '');
    if (reason && !chunks.some((text) => text.includes('OK') || text.includes(REMEMBER))) ctx.skip(reason);
    return { events: collected.events, result };
  } catch (error) {
    const reason = authReason(adapter.provider, error, collected.events);
    if (reason) ctx.skip(reason);
    throw error;
  }
}

function authReason(provider: string, error: unknown, events: UnifiedStreamEvent[]): string | null {
  const parts: string[] = [];
  if (error instanceof Error) parts.push(error.message);
  else if (error !== undefined && error !== null) parts.push(String(error));
  for (const event of events) {
    if (event.payload.error) parts.push(event.payload.error);
    if (event.payload.text) parts.push(event.payload.text);
  }
  const described = describeAuthFailure(provider, parts.join('\n'));
  return described?.message.split('\n').find((line) => line.trim().length > 0) ?? null;
}

function emittedFlags(adapter: CLIAdapter): string[] {
  const builder = adapter as CLIAdapter & { buildArgs?: (options: PromptOptions) => string[] };
  if (!builder.buildArgs) throw new Error(`${adapter.provider} does not expose buildArgs`);
  const samples: PromptOptions[] = [
    { prompt: 'hi', cwd: '/work' },
    { prompt: 'hi', cwd: '/work', mode: 'agent', yolo: true },
    { prompt: 'hi', cwd: '/work', mode: 'ask', yolo: false },
    { prompt: 'hi', cwd: '/work', mode: 'plan' },
    {
      prompt: 'hi',
      cwd: '/work',
      mode: 'agent',
      model: 'sonnet',
      providerSessionId: 'sess_1',
      systemPrompt: 'Be brief.',
      ephemeral: true,
      files: ['notes.txt'],
      allowedTools: ['Read'],
      yolo: true,
    },
  ];
  const flags = new Set<string>();
  for (const options of samples) {
    for (const arg of builder.buildArgs(options)) {
      if (!arg.startsWith('-') || arg === '--') continue;
      flags.add(arg.split('=')[0] ?? arg);
    }
  }
  return [...flags];
}

function cliHelp(binaryPath: string): Promise<string> {
  return execFileAsync(binaryPath, ['--help'], {
    timeout: 15_000,
    encoding: 'utf8',
    maxBuffer: 2_000_000,
  }).then(
    (result) => `${result.stdout}\n${result.stderr}`,
    (error: unknown) => {
      const record = typeof error === 'object' && error !== null ? (error as { stdout?: string; stderr?: string }) : {};
      const text = `${record.stdout ?? ''}\n${record.stderr ?? ''}`;
      if (text.trim()) return text;
      throw error;
    },
  );
}

function tempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}
