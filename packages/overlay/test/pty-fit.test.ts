import { afterEach, describe, expect, it, vi } from 'vitest';
import { FIT_DEBOUNCE_MS, createPtyFitController, ptySizeChanged } from '../src/ui/layout/pty-fit.js';

describe('pty fit debounce', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('detects size changes', () => {
    expect(ptySizeChanged(null, { cols: 80, rows: 24 })).toBe(true);
    expect(ptySizeChanged({ cols: 80, rows: 24 }, { cols: 80, rows: 24 })).toBe(false);
    expect(ptySizeChanged({ cols: 80, rows: 24 }, { cols: 100, rows: 24 })).toBe(true);
  });

  it('debounces host resize fit calls', () => {
    vi.useFakeTimers();
    const fit = vi.fn(() => ({ cols: 100, rows: 30 }));
    const sendResize = vi.fn();
    const controller = createPtyFitController({ fit, sendResize });
    controller.setSession('pty_1', { cols: 80, rows: 24 });

    controller.notifyHostResize();
    controller.notifyHostResize();
    controller.notifyHostResize();
    expect(fit).not.toHaveBeenCalled();
    expect(sendResize).not.toHaveBeenCalled();

    vi.advanceTimersByTime(FIT_DEBOUNCE_MS - 1);
    expect(fit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fit).toHaveBeenCalledTimes(1);

    controller.handleTermResize(100, 30);
    expect(sendResize).toHaveBeenCalledTimes(1);
    expect(sendResize).toHaveBeenCalledWith('pty_1', 100, 30);
    controller.handleTermResize(100, 30);
    expect(sendResize).toHaveBeenCalledTimes(1);

    controller.notifyHostResize();
    controller.dispose();
    vi.advanceTimersByTime(FIT_DEBOUNCE_MS);
    expect(fit).toHaveBeenCalledTimes(1);
  });
});
