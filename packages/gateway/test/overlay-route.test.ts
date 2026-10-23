import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startTestServer } from './helpers.js';

const dirs: string[] = [];

describe('GET /overlay.js', () => {
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('serves the IIFE without auth and with a javascript content-type', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'aidev-overlay-'));
    dirs.push(dir);
    const file = path.join(dir, 'overlay.js');
    await writeFile(file, 'window.__AI_DEVTOOLS_OVERLAY__=1;\n');
    const server = await startTestServer({
      overlayFile: file,
      registerDefaultRoot: false,
      authenticateFetch: false,
    });
    try {
      const response = await fetch(`${server.url}/overlay.js`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('javascript');
      expect(await response.text()).toContain('__AI_DEVTOOLS_OVERLAY__');
    } finally {
      await server.close();
    }
  });

  it('returns 404 with build instructions when the bundle is missing', async () => {
    const missing = path.join(tmpdir(), 'aidev-missing-overlay', 'overlay.js');
    const server = await startTestServer({
      overlayFile: missing,
      registerDefaultRoot: false,
      authenticateFetch: false,
    });
    try {
      const response = await fetch(`${server.url}/overlay.js`);
      expect(response.status).toBe(404);
      expect(await response.text()).toMatch(/Build @aidev\/overlay/);
    } finally {
      await server.close();
    }
  });
});
