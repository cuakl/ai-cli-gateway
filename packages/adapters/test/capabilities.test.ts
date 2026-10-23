import { ProviderCapabilitiesSchema, type ProviderType } from '@aidev/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  PROVIDER_MODEL_CACHE_MS,
  BinaryResolver,
  clearProviderCapabilityCache,
  getProviderCapabilities,
  parseCursorModelList,
  providerSetup,
  type CapabilityExecFile,
} from '../src/index.js';

const MODEL_TEXT = [
  'Available models',
  '',
  'auto - Auto (current, default)',
  'gpt-5.3-codex-low - Codex 5.3 Low',
  'grok-4.7-low - Grok 4.7  Low\u200b\u200b',
  'not a model line',
  '',
  'Tip: use --model <id> (or /model <id> in interactive mode) to switch.',
].join('\n');

const HELP = [
  '  -p, --print                  Print',
  '  --list-models                List available models and exit',
  '  --json-schema <schema>       JSON Schema for structured output',
  '  --output-format <format>     text | json | stream-json',
].join('\n');

beforeEach(() => {
  clearProviderCapabilityCache();
});

describe('parseCursorModelList', () => {
  it('reads id - label rows and ignores headers, tips, and blank lines', () => {
    expect(parseCursorModelList(MODEL_TEXT)).toEqual([
      { id: 'auto', label: 'Auto (current, default)' },
      { id: 'gpt-5.3-codex-low', label: 'Codex 5.3 Low' },
      { id: 'grok-4.7-low', label: 'Grok 4.7 Low' },
    ]);
  });

  it('accepts a JSON model list', () => {
    expect(
      parseCursorModelList(
        JSON.stringify({
          models: [
            { id: 'alpha', label: 'Alpha' },
            { name: 'beta' },
            'gamma',
            { id: 'alpha', label: 'Again' },
          ],
        }),
      ),
    ).toEqual([
      { id: 'alpha', label: 'Alpha' },
      { id: 'beta', label: 'beta' },
      { id: 'gamma', label: 'gamma' },
    ]);
  });

  it('returns an empty list when nothing looks like a model', () => {
    expect(parseCursorModelList('Sorry, models are unavailable\n')).toEqual([]);
  });
});

describe('getProviderCapabilities', () => {
  it('returns setup steps and no probes when every binary is missing', async () => {
    const calls: string[][] = [];
    const listed = await getProviderCapabilities({
      binaries: resolver({}),
      execFile: async (file, args) => {
        calls.push([file, ...args]);
        return { stdout: '', stderr: '' };
      },
    });

    expect(calls).toEqual([]);
    expect(listed.map((item) => item.provider)).toEqual(['cursor', 'antigravity', 'claude', 'codex']);
    expect(listed.map((item) => item.available)).toEqual([false, false, false, false]);
    for (const item of listed) {
      expect(item.binaryPath).toBeNull();
      expect(item.version).toBeNull();
      expect(item.supportsImages).toBe(false);
      expect(item.supportsJsonSchema).toBe(false);
      expect(item.setup).toEqual(providerSetup(item.provider));
      expect(ProviderCapabilitiesSchema.parse(item)).toEqual(item);
    }
    expect(listed[0]).toMatchObject({
      verified: true,
      modes: ['agent', 'ask', 'plan'],
      supportsResume: true,
      supportsSystemPrompt: true,
      models: [],
    });
    expect(listed[1]).toMatchObject({
      verified: false,
      modes: ['agent'],
      supportsResume: false,
      supportsSystemPrompt: false,
      models: [],
    });
    expect(listed[2]).toMatchObject({
      verified: true,
      modes: ['agent', 'ask', 'plan'],
      supportsResume: true,
      supportsSystemPrompt: true,
      models: [
        { id: 'sonnet', label: 'sonnet' },
        { id: 'opus', label: 'opus' },
        { id: 'haiku', label: 'haiku' },
      ],
    });
    expect(listed[3]).toMatchObject({
      verified: false,
      modes: ['agent', 'ask'],
      supportsResume: false,
      supportsSystemPrompt: false,
      models: [],
    });
  });

  it('reads version and cursor models, and caches both', async () => {
    const calls: string[][] = [];
    let clock = 1_000;
    const execFile: CapabilityExecFile = async (file, args) => {
      calls.push([file, ...args]);
      const flag = args[0];
      if (flag === '--version') {
        return file.endsWith('claude')
          ? { stdout: '', stderr: '\u001b[32m2.1.173 (Claude Code)\u001b[0m\n' }
          : { stdout: '2026.10.22-27dcf5f\n', stderr: '' };
      }
      if (flag === '--help') return { stdout: HELP, stderr: '' };
      if (flag === '--list-models') return { stdout: MODEL_TEXT, stderr: '' };
      throw new Error(`unexpected ${args.join(' ')}`);
    };
    const options = {
      binaries: resolver({ cursor: '/bin/agent', claude: '/bin/claude', codex: '/bin/codex' }),
      execFile,
      now: () => clock,
    };

    const first = await getProviderCapabilities(options);
    expect(first.find((item) => item.provider === 'cursor')).toMatchObject({
      available: true,
      binaryPath: '/bin/agent',
      version: '2026.10.22-27dcf5f',
      verified: true,
      supportsJsonSchema: false,
      supportsImages: false,
      models: [
        { id: 'auto', label: 'Auto (current, default)' },
        { id: 'gpt-5.3-codex-low', label: 'Codex 5.3 Low' },
        { id: 'grok-4.7-low', label: 'Grok 4.7 Low' },
      ],
    });
    expect(first.find((item) => item.provider === 'cursor')).not.toHaveProperty('setup');
    expect(first.find((item) => item.provider === 'claude')).toMatchObject({
      available: true,
      version: '2.1.173 (Claude Code)',
      supportsJsonSchema: true,
      supportsSystemPrompt: true,
      models: [
        { id: 'sonnet', label: 'sonnet' },
        { id: 'opus', label: 'opus' },
        { id: 'haiku', label: 'haiku' },
      ],
    });
    expect(first.find((item) => item.provider === 'codex')).toMatchObject({
      available: true,
      binaryPath: '/bin/codex',
      version: '2026.10.22-27dcf5f',
      verified: false,
      models: [],
      supportsJsonSchema: false,
    });
    expect(calls.filter((call) => call[1] === '--list-models').map((call) => call[0])).toEqual(['/bin/agent']);
    expect(calls.filter((call) => call[0] === '/bin/codex').map((call) => call[1])).toEqual(['--version']);

    const after = calls.length;
    await getProviderCapabilities(options);
    expect(calls.length).toBe(after);

    clock += PROVIDER_MODEL_CACHE_MS;
    await getProviderCapabilities(options);
    expect(calls.filter((call) => call[1] === '--version')).toHaveLength(3);
    expect(calls.filter((call) => call[1] === '--list-models')).toHaveLength(2);
    expect(calls.filter((call) => call[1] === '--help')).toHaveLength(2);
  });

  it('returns null version and empty cursor models when the probes fail', async () => {
    const calls: string[][] = [];
    const execFile: CapabilityExecFile = async (file, args) => {
      calls.push([file, ...args]);
      throw Object.assign(new Error('boom'), { stdout: '', stderr: 'nope' });
    };
    const listed = await getProviderCapabilities({
      binaries: resolver({ cursor: '/bin/agent', claude: '/bin/claude' }),
      execFile,
    });
    expect(listed.find((item) => item.provider === 'cursor')).toMatchObject({
      available: true,
      version: null,
      models: [],
      supportsJsonSchema: false,
    });
    expect(listed.find((item) => item.provider === 'claude')).toMatchObject({
      available: true,
      version: null,
      supportsJsonSchema: false,
    });
    expect(calls.some((call) => call[1] === '--list-models')).toBe(false);

    const count = calls.length;
    await getProviderCapabilities({
      binaries: resolver({ cursor: '/bin/agent', claude: '/bin/claude' }),
      execFile,
    });
    expect(calls.length).toBe(count);
  });

  it('does not list cursor models when --list-models is absent from help', async () => {
    const calls: string[][] = [];
    const listed = await getProviderCapabilities({
      binaries: resolver({ cursor: '/bin/agent', claude: '/bin/claude' }),
      execFile: async (file, args) => {
        calls.push([file, ...args]);
        if (args[0] === '--version') return { stdout: '1\n', stderr: '' };
        if (args[0] === '--help') return { stdout: '  -p, --print\n', stderr: '' };
        throw new Error('list-models should not run');
      },
    });
    expect(listed.find((item) => item.provider === 'cursor')?.models).toEqual([]);
    expect(listed.find((item) => item.provider === 'claude')?.supportsJsonSchema).toBe(false);
    expect(calls.some((call) => call[1] === '--list-models')).toBe(false);
  });
});

function resolver(paths: Partial<Record<ProviderType, string>>): BinaryResolver {
  const byCommand: Record<string, ProviderType> = {
    agent: 'cursor',
    'cursor-agent': 'cursor',
    agy: 'antigravity',
    claude: 'claude',
    codex: 'codex',
  };
  return new BinaryResolver({
    which: async (command) => {
      const provider = byCommand[command];
      if (!provider) return null;
      return paths[provider] ?? null;
    },
    isExecutable: async (filePath) => Object.values(paths).includes(filePath),
  });
}
