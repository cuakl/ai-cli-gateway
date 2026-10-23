import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PREFS_KEY,
  defaultPrefs,
  loadPrefs,
  loadSession,
  savePrefs,
  saveSession,
  sessionStorageKey,
  type OverlaySession,
} from '../src/ui/prefs.js';

class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.has(key) ? (this.data.get(key) ?? null) : null;
  }

  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, String(value));
  }
}

describe('overlay prefs storage', () => {
  const originalLocal = Object.getOwnPropertyDescriptor(window, 'localStorage');
  const originalSession = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
  let local: MemoryStorage;
  let session: MemoryStorage;

  beforeEach(() => {
    local = new MemoryStorage();
    session = new MemoryStorage();
    Object.defineProperty(window, 'localStorage', { configurable: true, value: local });
    Object.defineProperty(window, 'sessionStorage', { configurable: true, value: session });
  });

  afterEach(() => {
    restore('localStorage', originalLocal);
    restore('sessionStorage', originalSession);
  });

  it('round-trips prefs and per-project session', () => {
    const prefs = defaultPrefs();
    prefs.theme = 'light';
    prefs.dockMode = 'overlay';
    prefs.provider = 'claude';
    prefs.autoAttach = { consoleErrors: false, failedRequests: true, screenshot: false };
    prefs.pillCorner = 'top-left';
    prefs.sideWidth = 480;
    prefs.bottomHeight = 220;
    savePrefs(prefs);
    expect(local.getItem(PREFS_KEY)).toBe(JSON.stringify(prefs));
    expect(loadPrefs()).toEqual(prefs);

    const snapshot: OverlaySession = {
      sideOpen: true,
      sideTab: 'diffs',
      bottomOpen: true,
      bottomTab: 'tests',
      prompt: 'make it emerald',
      threadId: 'thr_1',
      selectedLoc: 'src/App.tsx:1:1',
    };
    saveSession('proj-a', snapshot);
    expect(session.getItem(sessionStorageKey('proj-a'))).toBe(JSON.stringify(snapshot));
    expect(loadSession('proj-a')).toEqual(snapshot);
    expect(loadSession('proj-b')).toEqual({});
  });

  it('falls back to defaults when stored JSON is invalid', () => {
    local.setItem(PREFS_KEY, '{not json');
    session.setItem(sessionStorageKey('proj-a'), '{also bad');
    expect(loadPrefs()).toEqual({});
    expect(loadSession('proj-a')).toEqual({});
  });

  it('does not throw when storage is unavailable', () => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('denied');
      },
    });
    Object.defineProperty(window, 'sessionStorage', { configurable: true, value: undefined });
    expect(() => loadPrefs()).not.toThrow();
    expect(() => savePrefs(defaultPrefs())).not.toThrow();
    expect(() => loadSession('proj-a')).not.toThrow();
    expect(() =>
      saveSession('proj-a', {
        sideOpen: false,
        sideTab: 'chat',
        bottomOpen: false,
        bottomTab: 'terminal',
        prompt: '',
        threadId: null,
        selectedLoc: null,
      }),
    ).not.toThrow();
    expect(loadPrefs()).toEqual({});
    expect(loadSession('proj-a')).toEqual({});
  });
});

function restore(name: 'localStorage' | 'sessionStorage', descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) {
    Object.defineProperty(window, name, descriptor);
    return;
  }
  Object.defineProperty(window, name, { configurable: true, value: undefined });
}
