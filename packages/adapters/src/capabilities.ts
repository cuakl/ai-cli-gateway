import { execFile as execFileCb } from 'node:child_process';
import {
  ProviderTypeSchema,
  type ProviderCapabilities,
  type ProviderModel,
  type ProviderType,
  type RunMode,
} from '@aidev/protocol';
import { BinaryResolver, providerSetup } from './utils/binary.js';

/** Cursor model lists are refreshed this often. Versions are cached until restart. */
export const PROVIDER_MODEL_CACHE_MS = 10 * 60 * 1000;

const VERSION_TIMEOUT_MS = 5_000;
const HELP_TIMEOUT_MS = 8_000;
const MODELS_TIMEOUT_MS = 15_000;
const MAX_BUFFER = 4 * 1024 * 1024;

const CLAUDE_MODELS: readonly ProviderModel[] = [
  { id: 'sonnet', label: 'sonnet' },
  { id: 'opus', label: 'opus' },
  { id: 'haiku', label: 'haiku' },
];

const TRAITS: Record<
  ProviderType,
  {
    verified: boolean;
    modes: readonly RunMode[];
    supportsResume: boolean;
    supportsSystemPrompt: boolean;
  }
> = {
  cursor: {
    verified: true,
    modes: ['agent', 'ask', 'plan'],
    supportsResume: true,
    supportsSystemPrompt: true,
  },
  claude: {
    verified: true,
    modes: ['agent', 'ask', 'plan'],
    supportsResume: true,
    supportsSystemPrompt: true,
  },
  codex: {
    verified: false,
    modes: ['agent', 'ask'],
    supportsResume: false,
    supportsSystemPrompt: false,
  },
  antigravity: {
    verified: false,
    modes: ['agent'],
    supportsResume: false,
    supportsSystemPrompt: false,
  },
};

export interface ExecFileResult {
  stdout: string;
  stderr: string;
}

/** `execFile` (no shell). Tests inject a fake; the default spawns the binary directly. */
export type CapabilityExecFile = (
  file: string,
  args: readonly string[],
  options: { timeout: number },
) => Promise<ExecFileResult>;

export interface GetProviderCapabilitiesOptions {
  binaries?: BinaryResolver;
  execFile?: CapabilityExecFile;
  now?: () => number;
}

interface ProbeFields {
  available: boolean;
  binaryPath: string | null;
  version: string | null;
  models: ProviderModel[];
  supportsJsonSchema: boolean;
}

const versionCache = new Map<string, string | null>();
const versionInflight = new Map<string, Promise<string | null>>();
const helpCache = new Map<string, string>();
const helpInflight = new Map<string, Promise<string>>();
const modelCache = new Map<string, { at: number; models: ProviderModel[] }>();
const modelInflight = new Map<string, Promise<ProviderModel[]>>();

export function clearProviderCapabilityCache(): void {
  versionCache.clear();
  versionInflight.clear();
  helpCache.clear();
  helpInflight.clear();
  modelCache.clear();
  modelInflight.clear();
}

/**
 * Capabilities for every provider. Missing binaries still return a row, with
 * `setup` taken from `providerSetup`. Version and Cursor model probes fail soft.
 */
export async function getProviderCapabilities(
  options: GetProviderCapabilitiesOptions = {},
): Promise<ProviderCapabilities[]> {
  const binaries = options.binaries ?? new BinaryResolver();
  const exec = options.execFile ?? defaultExecFile;
  const now = options.now ?? Date.now;
  return Promise.all(ProviderTypeSchema.options.map((provider) => probe(provider, binaries, exec, now)));
}

/** Static capability rows for a runtime that already knows which binaries exist. */
export function capabilitiesFromAvailability(
  detected: ReadonlyArray<{ provider: ProviderType; available: boolean; binaryPath: string | null }>,
): ProviderCapabilities[] {
  return detected.map((item) =>
    assemble(item.provider, {
      available: item.available,
      binaryPath: item.binaryPath,
      version: null,
      models: item.provider === 'claude' ? claudeModels() : [],
      supportsJsonSchema: false,
    }),
  );
}

/** Parse `agent --list-models` text. JSON arrays are accepted when a CLI emits them. */
export function parseCursorModelList(output: string): ProviderModel[] {
  const trimmed = output.trim();
  const json = parseModelJson(trimmed);
  if (json) return json;

  const models: ProviderModel[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.replace(/[\u200b\u200c\u200d\ufeff]/g, '').trim();
    const match = /^(?:[-*•]\s+)?([A-Za-z0-9][\w.+[\]=-]*)\s+[-–—]\s+(.+)$/.exec(line);
    if (!match) continue;
    const id = match[1]?.trim() ?? '';
    const label = (match[2] ?? '').replace(/\s+/g, ' ').trim();
    if (!id || !label) continue;
    models.push({ id, label });
  }
  return dedupe(models);
}

async function probe(
  provider: ProviderType,
  binaries: BinaryResolver,
  exec: CapabilityExecFile,
  now: () => number,
): Promise<ProviderCapabilities> {
  const binaryPath = await binaries.resolve(provider);
  if (!binaryPath) {
    return assemble(provider, {
      available: false,
      binaryPath: null,
      version: null,
      models: provider === 'claude' ? claudeModels() : [],
      supportsJsonSchema: false,
    });
  }

  const needsHelp = provider === 'cursor' || provider === 'claude';
  const [version, help] = await Promise.all([
    readVersion(binaryPath, exec),
    needsHelp ? readHelp(binaryPath, exec) : Promise.resolve(''),
  ]);
  const models =
    provider === 'claude'
      ? claudeModels()
      : provider === 'cursor'
        ? await readCursorModels(binaryPath, help, exec, now)
        : [];
  const supportsJsonSchema = provider === 'claude' && helpIncludesFlag(help, '--json-schema');
  return assemble(provider, {
    available: true,
    binaryPath,
    version,
    models,
    supportsJsonSchema,
  });
}

function assemble(provider: ProviderType, fields: ProbeFields): ProviderCapabilities {
  const traits = TRAITS[provider];
  const available = fields.available && fields.binaryPath !== null;
  const capability: ProviderCapabilities = {
    provider,
    available,
    binaryPath: available ? fields.binaryPath : null,
    version: available ? fields.version : null,
    verified: traits.verified,
    modes: [...traits.modes],
    models: fields.models.map((model) => ({ id: model.id, label: model.label })),
    supportsResume: traits.supportsResume,
    supportsImages: false,
    supportsJsonSchema: available ? fields.supportsJsonSchema : false,
    supportsSystemPrompt: traits.supportsSystemPrompt,
  };
  if (!available) capability.setup = providerSetup(provider);
  return capability;
}

function claudeModels(): ProviderModel[] {
  return CLAUDE_MODELS.map((model) => ({ id: model.id, label: model.label }));
}

async function readVersion(binaryPath: string, exec: CapabilityExecFile): Promise<string | null> {
  if (versionCache.has(binaryPath)) return versionCache.get(binaryPath) ?? null;
  const pending = versionInflight.get(binaryPath);
  if (pending) return pending;
  const task = fetchVersion(binaryPath, exec).then((version) => {
    versionCache.set(binaryPath, version);
    return version;
  });
  versionInflight.set(binaryPath, task);
  void task.finally(() => versionInflight.delete(binaryPath));
  return task;
}

async function fetchVersion(binaryPath: string, exec: CapabilityExecFile): Promise<string | null> {
  try {
    const { stdout, stderr } = await exec(binaryPath, ['--version'], { timeout: VERSION_TIMEOUT_MS });
    return firstLine(stdout, stderr);
  } catch {
    return null;
  }
}

async function readHelp(binaryPath: string, exec: CapabilityExecFile): Promise<string> {
  if (helpCache.has(binaryPath)) return helpCache.get(binaryPath) ?? '';
  const pending = helpInflight.get(binaryPath);
  if (pending) return pending;
  const task = fetchHelp(binaryPath, exec).then((help) => {
    helpCache.set(binaryPath, help);
    return help;
  });
  helpInflight.set(binaryPath, task);
  void task.finally(() => helpInflight.delete(binaryPath));
  return task;
}

async function fetchHelp(binaryPath: string, exec: CapabilityExecFile): Promise<string> {
  try {
    const { stdout, stderr } = await exec(binaryPath, ['--help'], { timeout: HELP_TIMEOUT_MS });
    return `${stdout}\n${stderr}`;
  } catch (error) {
    const output = outputOf(error);
    return `${output.stdout}\n${output.stderr}`;
  }
}

async function readCursorModels(
  binaryPath: string,
  help: string,
  exec: CapabilityExecFile,
  now: () => number,
): Promise<ProviderModel[]> {
  const cached = modelCache.get(binaryPath);
  if (cached && now() - cached.at < PROVIDER_MODEL_CACHE_MS) {
    return cached.models.map((model) => ({ ...model }));
  }
  const pending = modelInflight.get(binaryPath);
  if (pending) return pending;
  const task = fetchCursorModels(binaryPath, help, exec, now);
  modelInflight.set(binaryPath, task);
  void task.finally(() => modelInflight.delete(binaryPath));
  return task;
}

async function fetchCursorModels(
  binaryPath: string,
  help: string,
  exec: CapabilityExecFile,
  now: () => number,
): Promise<ProviderModel[]> {
  if (!helpIncludesFlag(help, '--list-models')) {
    const models: ProviderModel[] = [];
    modelCache.set(binaryPath, { at: now(), models });
    return models;
  }
  try {
    const { stdout, stderr } = await exec(binaryPath, ['--list-models'], { timeout: MODELS_TIMEOUT_MS });
    const models = parseCursorModelList(`${stdout}\n${stderr}`);
    modelCache.set(binaryPath, { at: now(), models });
    return models.map((model) => ({ ...model }));
  } catch {
    const models: ProviderModel[] = [];
    modelCache.set(binaryPath, { at: now(), models });
    return models;
  }
}

export function helpIncludesFlag(help: string, flag: string): boolean {
  const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\s)${escaped}(?=$|[\\s,=\\[\\]|])`, 'm').test(help);
}

function parseModelJson(text: string): ProviderModel[] | null {
  if (!text.startsWith('{') && !text.startsWith('[')) return null;
  try {
    return dedupe(modelsFromJson(JSON.parse(text) as unknown));
  } catch {
    return null;
  }
}

function modelsFromJson(value: unknown): ProviderModel[] {
  const list = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.models) ? value.models : null;
  if (!list) return [];
  const models: ProviderModel[] = [];
  for (const item of list) {
    if (typeof item === 'string') {
      const id = item.trim();
      if (id) models.push({ id, label: id });
      continue;
    }
    if (!isRecord(item)) continue;
    const id = stringValue(item.id ?? item.name ?? item.model);
    const label = stringValue(item.label ?? item.displayName ?? item.name ?? item.id);
    if (id && label) models.push({ id, label });
  }
  return models;
}

function dedupe(models: ProviderModel[]): ProviderModel[] {
  const seen = new Set<string>();
  const unique: ProviderModel[] = [];
  for (const model of models) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    unique.push(model);
  }
  return unique;
}

function firstLine(stdout: string, stderr: string): string | null {
  const line = stripAnsi(`${stdout}\n${stderr}`)
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.length > 0);
  if (!line) return null;
  return line.length > 200 ? line.slice(0, 200) : line;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

function outputOf(error: unknown): { stdout: string; stderr: string } {
  if (!isRecord(error)) return { stdout: '', stderr: '' };
  return {
    stdout: typeof error.stdout === 'string' ? error.stdout : '',
    stderr: typeof error.stderr === 'string' ? error.stderr : '',
  };
}

function stringValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/[\u200b\u200c\u200d\ufeff]/g, '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function defaultExecFile(
  file: string,
  args: readonly string[],
  options: { timeout: number },
): Promise<ExecFileResult> {
  return new Promise((resolve, reject) => {
    execFileCb(
      file,
      [...args],
      {
        timeout: options.timeout,
        encoding: 'utf8',
        maxBuffer: MAX_BUFFER,
        windowsHide: true,
        shell: false,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}
