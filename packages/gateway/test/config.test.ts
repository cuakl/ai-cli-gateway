import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HOME_DIRNAME } from '../src/brand.js';
import { resolveConfig } from '../src/config.js';

describe('resolveConfig', () => {
  it('binds loopback port 4100 and the default home when HOST and PORT are unset', () => {
    const config = resolveConfig({});
    expect(config).toEqual({
      host: '127.0.0.1',
      port: 4100,
      home: join(homedir(), HOME_DIRNAME),
    });
    expect(resolveConfig({ HOST: '   ', PORT: '' }).host).toBe('127.0.0.1');
    expect(resolveConfig({}).root).toBeUndefined();
  });

  it('reads HOST, PORT, AIDEV_HOME, and an explicit project root', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'gateway-root-')));
    const home = join(tmpdir(), 'aidev-home-config');
    try {
      expect(resolveConfig({ HOST: '0.0.0.0', PORT: '4150', GATEWAY_ROOT: root, AIDEV_HOME: home })).toEqual({
        host: '0.0.0.0',
        port: 4150,
        home,
        root,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a GATEWAY_ROOT that does not exist', () => {
    expect(() => resolveConfig({ GATEWAY_ROOT: join(tmpdir(), 'gateway-root-missing') })).toThrow(/GATEWAY_ROOT/);
  });

  it('rejects a port that is not an integer in range', () => {
    expect(() => resolveConfig({ PORT: 'nope' })).toThrow(/Invalid PORT/);
    expect(() => resolveConfig({ PORT: '70000' })).toThrow(/Invalid PORT/);
  });
});
