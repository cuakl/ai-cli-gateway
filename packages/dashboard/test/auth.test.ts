import { describe, expect, it } from 'vitest';
import { TOKEN_STORAGE_KEY, captureTokenFromHash, readStoredToken } from '../src/auth.js';

class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>();
  get length(): number {
    return this.data.size;
  }
  clear(): void {
    this.data.clear();
  }
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

describe('captureTokenFromHash', () => {
  it('stores the hash token, strips it from the URL, and never uses a query string', () => {
    const storage = new MemoryStorage();
    const replaced: string[] = [];
    const token = captureTokenFromHash(
      { hash: '#token=machine_secret', pathname: '/dashboard/', search: '' },
      {
        replaceState(_data, _unused, url) {
          replaced.push(String(url));
        },
      },
      storage,
    );
    expect(token).toBe('machine_secret');
    expect(storage.getItem(TOKEN_STORAGE_KEY)).toBe('machine_secret');
    expect(replaced).toEqual(['/dashboard/']);
    expect(replaced[0]).not.toContain('token=');
    expect(replaced[0]).not.toContain('?');
  });

  it('keeps other hash params after removing token', () => {
    const storage = new MemoryStorage();
    const replaced: string[] = [];
    captureTokenFromHash(
      { hash: '#view=threads&token=abc', pathname: '/dashboard/', search: '' },
      {
        replaceState(_data, _unused, url) {
          replaced.push(String(url));
        },
      },
      storage,
    );
    expect(replaced).toEqual(['/dashboard/#view=threads']);
    expect(replaced[0]).not.toContain('token=');
  });

  it('reads a previously stored token when the hash has none', () => {
    const storage = new MemoryStorage();
    storage.setItem(TOKEN_STORAGE_KEY, 'persisted');
    const replaced: string[] = [];
    const token = captureTokenFromHash(
      { hash: '', pathname: '/dashboard/', search: '' },
      {
        replaceState(_data, _unused, url) {
          replaced.push(String(url));
        },
      },
      storage,
    );
    expect(token).toBe('persisted');
    expect(replaced).toEqual([]);
    expect(readStoredToken(storage)).toBe('persisted');
  });

  it('returns null when neither the hash nor sessionStorage has a token', () => {
    const token = captureTokenFromHash(
      { hash: '#', pathname: '/dashboard/', search: '?foo=1' },
      { replaceState() {} },
      new MemoryStorage(),
    );
    expect(token).toBeNull();
  });
});
