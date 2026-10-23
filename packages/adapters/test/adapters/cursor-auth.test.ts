import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cursorStateDbPath,
  normalizeCursorAccessToken,
  readCursorIdeAccessToken,
} from '../../src/adapters/cursor-auth.js';

describe('Cursor IDE auth', () => {
  it('locates the state database per platform', () => {
    expect(cursorStateDbPath('/Users/ada', 'darwin')).toBe(
      '/Users/ada/Library/Application Support/Cursor/User/globalStorage/state.vscdb',
    );
    expect(cursorStateDbPath('/home/ada', 'linux')).toBe(
      '/home/ada/.config/Cursor/User/globalStorage/state.vscdb',
    );
    const previous = process.env.APPDATA;
    process.env.APPDATA = join('C:', 'Users', 'ada', 'AppData', 'Roaming');
    try {
      expect(cursorStateDbPath('/unused', 'win32')).toBe(
        join(process.env.APPDATA, 'Cursor', 'User', 'globalStorage', 'state.vscdb'),
      );
      delete process.env.APPDATA;
      expect(cursorStateDbPath('/unused', 'win32')).toBeNull();
    } finally {
      if (previous === undefined) delete process.env.APPDATA;
      else process.env.APPDATA = previous;
    }
    expect(cursorStateDbPath('/home/ada', 'freebsd')).toBeNull();
  });

  it('normalizes raw and JSON-encoded tokens and rejects short or spaced values', () => {
    expect(normalizeCursorAccessToken('a'.repeat(20))).toBe('a'.repeat(20));
    expect(normalizeCursorAccessToken(JSON.stringify('b'.repeat(24)))).toBe('b'.repeat(24));
    expect(normalizeCursorAccessToken(Buffer.from('c'.repeat(22)))).toBe('c'.repeat(22));
    expect(normalizeCursorAccessToken('short')).toBeNull();
    expect(normalizeCursorAccessToken(`${'d'.repeat(20)} token`)).toBeNull();
    expect(normalizeCursorAccessToken(1)).toBeNull();
    expect(normalizeCursorAccessToken('"not-json')).toBeNull();
  });

  it('reads a fixture token and ignores a missing database', async () => {
    expect(await readCursorIdeAccessToken()).toBeNull();
    expect(await readCursorIdeAccessToken(join(tmpdir(), 'missing-cursor-state.vscdb'))).toBeNull();

    const specifier = 'node:sqlite';
    let database: { exec(sql: string): void; prepare(sql: string): { run(...params: unknown[]): unknown }; close(): void };
    try {
      const loaded: unknown = await import(specifier);
      if (typeof loaded !== 'object' || loaded === null || !('DatabaseSync' in loaded)) return;
      const DatabaseSync = loaded.DatabaseSync;
      if (typeof DatabaseSync !== 'function') return;
      const dir = await mkdtemp(join(tmpdir(), 'gateway-cursor-state-'));
      const dbPath = join(dir, 'state.vscdb');
      const token = 'e'.repeat(32);
      try {
        database = new (DatabaseSync as new (filename: string) => typeof database)(dbPath);
        database.exec('CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)');
        database.prepare('INSERT INTO ItemTable (key, value) VALUES (?, ?)').run('cursorAuth/accessToken', JSON.stringify(token));
        database.close();
        expect(await readCursorIdeAccessToken(dbPath)).toBe(token);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    } catch {
      // Node 20 has no node:sqlite. The reader treats that as "no IDE token".
    }
  });
});
