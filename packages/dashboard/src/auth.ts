export const TOKEN_STORAGE_KEY = 'aidev.dashboard.token';

export interface LocationLike {
  hash: string;
  pathname: string;
  search: string;
}

export interface HistoryLike {
  replaceState(data: unknown, unused: string, url?: string | null): void;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Read `#token=` from the URL hash, persist it in sessionStorage, and strip it
 * with history.replaceState. Never writes the token into a query string.
 */
export function captureTokenFromHash(
  location: LocationLike,
  history: HistoryLike,
  storage: StorageLike,
): string | null {
  const raw = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
  const params = new URLSearchParams(raw);
  const fromHash = params.get('token')?.trim() ?? '';
  if (fromHash) {
    storage.setItem(TOKEN_STORAGE_KEY, fromHash);
    params.delete('token');
    const nextHash = params.toString();
    const url = `${location.pathname}${location.search}${nextHash ? `#${nextHash}` : ''}`;
    history.replaceState(null, '', url);
    return fromHash;
  }
  const stored = storage.getItem(TOKEN_STORAGE_KEY)?.trim() ?? '';
  return stored || null;
}

export function readStoredToken(storage: StorageLike): string | null {
  const stored = storage.getItem(TOKEN_STORAGE_KEY)?.trim() ?? '';
  return stored || null;
}
