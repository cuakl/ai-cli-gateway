import { homedir } from 'node:os';
import { join } from 'node:path';

const ACCESS_TOKEN_KEY = 'cursorAuth/accessToken';
const MIN_TOKEN_LENGTH = 20;

interface SqliteStatement {
  get(...params: unknown[]): unknown;
}

interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  close(): void;
}

interface SqliteModule {
  DatabaseSync: new (filename: string, options?: { readOnly?: boolean }) => SqliteDatabase;
}

/**
 * Cursor's local state database. The CLI does not read this file itself.
 * Returns null on platforms where the app does not keep a state database.
 */
export function cursorStateDbPath(home = homedir(), platform = process.platform): string | null {
  if (platform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  }
  if (platform === 'linux') {
    return join(home, '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  }
  if (platform === 'win32') {
    const appData = process.env.APPDATA;
    if (!appData) return null;
    return join(appData, 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  }
  return null;
}

/** Accepts a raw token or a JSON-encoded string. Never logs the value. */
export function normalizeCursorAccessToken(value: unknown): string | null {
  const text = tokenText(value);
  if (!text) return null;
  let token = text.trim();
  if (token.startsWith('"') && token.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(token);
      if (typeof parsed !== 'string') return null;
      token = parsed.trim();
    } catch {
      return null;
    }
  }
  if (token.length < MIN_TOKEN_LENGTH || /\s/.test(token)) return null;
  return token;
}

/**
 * Reads the Cursor IDE access token for the current user.
 * A missing database, an unreadable file, or a Node runtime without
 * `node:sqlite` all return null so the CLI can use its own login.
 * Under Vitest the default path is skipped so unit tests do not touch
 * the developer database. Pass `dbPath` to read a fixture.
 */
export async function readCursorIdeAccessToken(dbPath?: string | null): Promise<string | null> {
  const resolved = dbPath === undefined ? defaultCursorStateDbPath() : dbPath;
  if (!resolved) return null;
  let database: SqliteDatabase | null = null;
  try {
    const loaded: unknown = await import('node:sqlite');
    if (!isSqliteModule(loaded)) return null;
    database = new loaded.DatabaseSync(resolved, { readOnly: true });
    const row = database.prepare('SELECT value FROM ItemTable WHERE key = ?').get(ACCESS_TOKEN_KEY);
    if (!isRow(row)) return null;
    return normalizeCursorAccessToken(row.value);
  } catch {
    return null;
  } finally {
    try {
      database?.close();
    } catch {
      // Closing a failed handle is irrelevant to the caller.
    }
  }
}

function defaultCursorStateDbPath(): string | null {
  if (process.env.VITEST) return null;
  return cursorStateDbPath();
}

function tokenText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value instanceof Uint8Array) return Buffer.from(value).toString('utf8');
  return null;
}

function isSqliteModule(value: unknown): value is SqliteModule {
  if (typeof value !== 'object' || value === null || !('DatabaseSync' in value)) return false;
  return typeof value.DatabaseSync === 'function';
}

function isRow(value: unknown): value is { value: unknown } {
  return typeof value === 'object' && value !== null && 'value' in value;
}
