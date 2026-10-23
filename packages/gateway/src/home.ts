import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { AidevConfigSchema, type AidevConfig } from '@aidev/protocol';
import { HOME_DIRNAME } from './brand.js';

const TOKEN_NAME = 'token';
const CONFIG_NAME = 'config.json';

/** 32 random bytes, base64url, with no padding. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * `AIDEV_HOME` when set, otherwise `~/.aidev`.
 * The directory is not created here.
 */
export function resolveAidevHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.AIDEV_HOME?.trim();
  if (override) return path.resolve(override);
  return path.join(homedir(), HOME_DIRNAME);
}

export function defaultConfig(): AidevConfig {
  return {
    port: 4100,
    projects: [],
    inferenceTokens: [],
    retentionDays: 7,
    maxConcurrentRuns: 4,
    editor: 'auto',
  };
}

export async function readConfig(home: string): Promise<AidevConfig> {
  let raw = '';
  try {
    raw = await readFile(path.join(home, CONFIG_NAME), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultConfig();
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`Invalid JSON in ${path.join(home, CONFIG_NAME)}`);
  }
  const result = AidevConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path.join('.') || 'config';
    throw new Error(`Invalid ${CONFIG_NAME} (${where}: ${issue?.message ?? 'schema mismatch'})`);
  }
  return result.data;
}

/** Atomic replace so a crash cannot leave a half-written config. */
export async function writeConfig(home: string, config: AidevConfig): Promise<void> {
  const parsed = AidevConfigSchema.parse(config);
  await writeSecretFile(home, CONFIG_NAME, `${JSON.stringify(parsed, null, 2)}\n`);
}

/**
 * Write `name` under `home` with mode 0600, using a temp file and rename.
 * The home directory is created (0700) when it is missing.
 */
export async function writeSecretFile(home: string, name: string, contents: string): Promise<void> {
  await mkdir(home, { recursive: true, mode: 0o700 });
  const file = path.join(home, name);
  const tmp = path.join(home, `.${name}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tmp, contents, { encoding: 'utf8', mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, file);
  await chmod(file, 0o600);
}

export async function readMachineToken(home: string): Promise<string> {
  return (await readFile(path.join(home, TOKEN_NAME), 'utf8')).trim();
}

/**
 * Create the home directory, the machine token (mode 0600), and a default
 * config when they are missing. An existing token is kept and tightened to 0600.
 */
export async function ensureHome(home: string): Promise<{ home: string; token: string; config: AidevConfig }> {
  await mkdir(home, { recursive: true, mode: 0o700 });
  await chmod(home, 0o700);
  const token = await ensureToken(home);
  const config = await ensureConfig(home);
  return { home, token, config };
}

async function ensureToken(home: string): Promise<string> {
  const file = path.join(home, TOKEN_NAME);
  try {
    const existing = (await readFile(file, 'utf8')).trim();
    if (existing) {
      await chmod(file, 0o600);
      return existing;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const token = generateToken();
  await writeFile(file, `${token}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await chmod(file, 0o600);
  return token;
}

async function ensureConfig(home: string): Promise<AidevConfig> {
  const file = path.join(home, CONFIG_NAME);
  try {
    await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const config = defaultConfig();
    await writeConfig(home, config);
    return config;
  }
  return readConfig(home);
}
