export const FIT_DEBOUNCE_MS = 80;

export interface PtySize {
  cols: number;
  rows: number;
}

export function ptySizeChanged(prev: PtySize | null, next: PtySize): boolean {
  if (!prev) return true;
  return prev.cols !== next.cols || prev.rows !== next.rows;
}

export function createPtyFitController(options: {
  fit: () => PtySize | null;
  sendResize: (sessionId: string, cols: number, rows: number) => void;
  delay?: number;
}): {
  notifyHostResize: () => void;
  setSession: (sessionId: string, size: PtySize) => void;
  handleTermResize: (cols: number, rows: number) => void;
  dispose: () => void;
} {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sessionId = '';
  let last: PtySize | null = null;
  const delay = options.delay ?? FIT_DEBOUNCE_MS;

  function emit(next: PtySize): void {
    if (!sessionId) return;
    if (!ptySizeChanged(last, next)) return;
    last = next;
    options.sendResize(sessionId, next.cols, next.rows);
  }

  return {
    notifyHostResize() {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        options.fit();
      }, delay);
    },
    setSession(id, size) {
      sessionId = id;
      last = size;
    },
    handleTermResize(cols, rows) {
      emit({ cols, rows });
    },
    dispose() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}
