import { afterEach, describe, expect, it } from 'vitest';
import { getErrors, installErrorCapture, uninstallErrorCapture } from '../src/context/errors.js';

interface EarlyHost {
  __AI_DEVTOOLS_EARLY__?: {
    errors: Array<Record<string, unknown>>;
  };
}

describe('error capture', () => {
  afterEach(() => {
    uninstallErrorCapture();
    window.onerror = null;
    delete (window as EarlyHost).__AI_DEVTOOLS_EARLY__;
  });

  it('records window.onerror with the source location and chains the previous handler', () => {
    let chained = false;
    window.onerror = () => {
      chained = true;
      return false;
    };
    installErrorCapture();
    window.onerror?.('explode', 'main.tsx', 12, 3, new Error('explode'));

    expect(chained).toBe(true);
    const [error] = getErrors();
    expect(error).toMatchObject({
      type: 'runtime',
      message: 'explode (main.tsx:12:3)',
      timestamp: expect.any(Number),
    });
    expect(error?.stack).toContain('explode');
  });

  it('records unhandledrejection events', () => {
    installErrorCapture();
    const reason = new Error('rejected');
    const event = new Event('unhandledrejection');
    Object.defineProperty(event, 'reason', { value: reason });
    window.dispatchEvent(event);

    expect(getErrors()[0]).toMatchObject({
      type: 'unhandled_rejection',
      message: 'rejected',
    });
  });

  it('drains early buffered errors on install and keeps their timestamps', () => {
    const stamped = 1_700_000_000_000;
    (window as EarlyHost).__AI_DEVTOOLS_EARLY__ = {
      errors: [
        { message: 'early boom', stack: 'Error: early boom', filename: 'boot.ts', lineno: 2, colno: 1, timestamp: stamped },
        { message: 'early boom', stack: 'Error: early boom', filename: 'boot.ts', lineno: 2, colno: 1, timestamp: stamped },
        { tag: 'IMG', src: 'https://cdn.test/missing.png', timestamp: stamped + 1 },
      ],
    };
    installErrorCapture();
    const recorded = getErrors();
    expect(recorded).toHaveLength(2);
    expect(recorded[0]).toMatchObject({
      type: 'runtime',
      message: expect.stringContaining('early boom'),
      timestamp: stamped,
    });
    expect(recorded[1]?.message).toContain('Failed to load IMG');
    expect(recorded[1]?.timestamp).toBe(stamped + 1);
    expect((window as EarlyHost).__AI_DEVTOOLS_EARLY__?.errors).toEqual([]);
  });

  it('records resource load failures from a capture-phase error', () => {
    installErrorCapture();
    const image = document.createElement('img');
    image.src = 'https://cdn.test/broken.png';
    document.body.append(image);
    const event = new Event('error', { bubbles: true });
    Object.defineProperty(event, 'target', { value: image });
    window.dispatchEvent(event);
    expect(getErrors()[0]?.message).toContain('Failed to load IMG');
    image.remove();
  });

  it('keeps the last 50 errors', () => {
    installErrorCapture();
    for (let index = 0; index < 55; index += 1) {
      window.onerror?.(`e${index}`, 'app.js', index, 0, undefined as unknown as Error);
    }
    const errors = getErrors();
    expect(errors).toHaveLength(50);
    expect(errors[0]?.message).toContain('e5');
    expect(errors[49]?.message).toContain('e54');
  });
});
