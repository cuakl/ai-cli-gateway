import { describe, expect, it, vi } from 'vitest';
import { createHmrGuard } from '../src/hmr-guard.js';

describe('HMR reload guard', () => {
  it('collapses full reloads that arrive while a prompt is running', () => {
    vi.useFakeTimers();
    try {
      const sent: unknown[] = [];
      const ws = {
        send(payload: unknown) {
          sent.push(payload);
        },
      };
      const guard = createHmrGuard(ws, 250);
      guard.begin();
      ws.send({ type: 'full-reload', path: 'src/a.tsx' });
      ws.send({ type: 'update', updates: ['src/a.tsx'] });
      ws.send({ type: 'full-reload', path: 'src/b.tsx' });

      expect(sent).toEqual([{ type: 'update', updates: ['src/a.tsx'] }]);
      vi.advanceTimersByTime(250);
      expect(sent).toHaveLength(1);

      guard.end();
      vi.advanceTimersByTime(249);
      expect(sent).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(sent).toEqual([
        { type: 'update', updates: ['src/a.tsx'] },
        { type: 'full-reload', path: 'src/b.tsx' },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends a full reload immediately when nothing is held', () => {
    const sent: unknown[] = [];
    const ws = {
      send(payload: unknown) {
        sent.push(payload);
      },
    };
    createHmrGuard(ws, 250);
    ws.send({ type: 'full-reload' });
    expect(sent).toEqual([{ type: 'full-reload' }]);
  });
});
