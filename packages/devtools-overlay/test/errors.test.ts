import { afterEach, describe, expect, it } from 'vitest';
import { getErrors, installErrorCapture, uninstallErrorCapture } from '../src/context/errors.js';

describe('error capture', () => {
  afterEach(() => {
    uninstallErrorCapture();
    window.onerror = null;
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
