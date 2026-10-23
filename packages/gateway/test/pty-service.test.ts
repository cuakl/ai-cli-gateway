import { describe, expect, it } from 'vitest';
import { sanitizePtyEnv, spawnPty } from '../src/workspace/pty-service.js';

describe('pty service', () => {
  it('strips credential environment variables and keeps PATH', () => {
    const env = sanitizePtyEnv(
      {
        PATH: '/usr/bin',
        NODE_PATH: '/lib',
        HOME: '/Users/dev',
        SECRET_TOKEN: 's',
        API_KEY: 'k',
        PASSWORD: 'p',
      },
      80,
      24,
    );
    expect(env.PATH).toBe('/usr/bin');
    expect(env.NODE_PATH).toBe('/lib');
    expect(env.HOME).toBe('/Users/dev');
    expect(env.SECRET_TOKEN).toBeUndefined();
    expect(env.API_KEY).toBeUndefined();
    expect(env.PASSWORD).toBeUndefined();
    expect(env.TERM).toBe('xterm-256color');
  });

  it('spawns an interactive shell and echoes a command', async () => {
    const chunks: string[] = [];
    const session = await spawnPty({
      cwd: process.cwd(),
      cols: 80,
      rows: 24,
      shell: '/bin/bash',
      onData: (data) => chunks.push(data),
      onExit: () => {},
    });
    try {
      await waitFor(() => chunks.join('').length > 0);
      session.write('printf pty-ok\\\\n\n');
      await waitFor(() => chunks.join('').includes('pty-ok'));
      expect(session.fallback).toBe(false);
    } finally {
      session.dispose();
    }
  });

  it('falls back to a pipe shell when node-pty cannot load', async () => {
    const chunks: string[] = [];
    const session = await spawnPty({
      cwd: process.cwd(),
      cols: 80,
      rows: 24,
      shell: '/bin/bash',
      loadPty: async () => null,
      onData: (data) => chunks.push(data),
      onExit: () => {},
    });
    try {
      expect(session.fallback).toBe(true);
      session.write('printf pty-fallback\\\\n\n');
      await waitFor(() => chunks.join('').includes('pty-fallback'));
      expect(chunks.join('')).toContain('compatibility shell');
    } finally {
      session.dispose();
    }
  });
});

async function waitFor(ready: () => boolean): Promise<void> {
  const started = Date.now();
  while (!ready()) {
    if (Date.now() - started > 8_000) {
      throw new Error('Timed out waiting for the shell');
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
