import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/config.js';

describe('resolveConfig', () => {
  it('binds loopback port 4100 when HOST and PORT are unset', () => {
    expect(resolveConfig({})).toEqual({ host: '127.0.0.1', port: 4100 });
    expect(resolveConfig({ HOST: '   ', PORT: '' })).toEqual({ host: '127.0.0.1', port: 4100 });
  });

  it('reads HOST and PORT', () => {
    expect(resolveConfig({ HOST: '0.0.0.0', PORT: '4150' })).toEqual({
      host: '0.0.0.0',
      port: 4150,
    });
  });

  it('rejects a port that is not an integer in range', () => {
    expect(() => resolveConfig({ PORT: 'nope' })).toThrow(/Invalid PORT/);
    expect(() => resolveConfig({ PORT: '70000' })).toThrow(/Invalid PORT/);
  });
});
