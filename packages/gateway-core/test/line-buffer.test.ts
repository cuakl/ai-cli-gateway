import { describe, expect, it } from 'vitest';
import { LineBuffer } from '../src/session/stream.js';

describe('LineBuffer', () => {
  it('keeps a partial line until the newline arrives', () => {
    const buffer = new LineBuffer();
    expect(buffer.push('hello\nwor')).toEqual(['hello']);
    expect(buffer.push('ld\n')).toEqual(['world']);
    expect(buffer.flush()).toEqual([]);
  });

  it('flushes a trailing line that never received a newline', () => {
    const buffer = new LineBuffer();
    expect(buffer.push('no-newline')).toEqual([]);
    expect(buffer.flush()).toEqual(['no-newline']);
  });

  it('splits CRLF and drops empty lines', () => {
    const buffer = new LineBuffer();
    expect(buffer.push('a\r\n\r\nb\r\n')).toEqual(['a', 'b']);
  });
});
