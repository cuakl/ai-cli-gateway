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

  it('serves a same-directory chunk at /overlay/* without auth', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'aidev-overlay-'));
    dirs.push(dir);
    await writeFile(path.join(dir, 'overlay.js'), 'window.__AI_DEVTOOLS_OVERLAY__=1;\n');
    await writeFile(path.join(dir, 'app.js'), 'export const overlayApp=1;\n');
    const server = await startTestServer({
      overlayFile: path.join(dir, 'overlay.js'),
      registerDefaultRoot: false,
      authenticateFetch: false,
    });
    try {
      const response = await fetch(`${server.url}/overlay/app.js`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('javascript');
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
      expect(await response.text()).toContain('overlayApp');
    } finally {
      await server.close();
    }
  });

  it('rejects path traversal into files outside dist', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'aidev-overlay-'));
    dirs.push(dir);
    await writeFile(path.join(dir, 'overlay.js'), 'window.__AI_DEVTOOLS_OVERLAY__=1;\n');
    const server = await startTestServer({
      overlayFile: path.join(dir, 'overlay.js'),
      registerDefaultRoot: false,
      authenticateFetch: false,
    });
    try {
      const escaped = await fetch(`${server.url}/overlay/../package.json`);
      expect(escaped.status).toBe(404);
      const encoded = await fetch(`${server.url}/overlay/%2e%2e/package.json`);
      expect(encoded.status).toBe(404);
    } finally {
      await server.close();
    }
  });
});
