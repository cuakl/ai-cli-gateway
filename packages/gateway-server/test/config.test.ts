import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/config.js';

describe('resolveConfig', () => {
  it('binds loopback port 4100 and the git root when HOST and PORT are unset', () => {
    const config = resolveConfig({});
    const gitRoot = realpathSync(
      execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim(),
    );
    expect(config).toEqual({ host: '127.0.0.1', port: 4100, root: gitRoot });
    expect(resolveConfig({ HOST: '   ', PORT: '' }).host).toBe('127.0.0.1');
  });

  it('reads HOST and PORT and an explicit project root', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'gateway-root-')));
    try {
      expect(resolveConfig({ HOST: '0.0.0.0', PORT: '4150', GATEWAY_ROOT: root })).toEqual({
        host: '0.0.0.0',
        port: 4150,
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
