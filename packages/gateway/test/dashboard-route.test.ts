import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startTestServer } from './helpers.js';

const dirs: string[] = [];

describe('GET /dashboard', () => {
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('serves index.html and assets without auth, and never embeds the machine token', async () => {
    const dist = await mkdtemp(path.join(tmpdir(), 'aidev-dashboard-'));
    dirs.push(dist);
    await writeFile(
      path.join(dist, 'index.html'),
      '<!doctype html><title>AI DevTools</title><script src="/dashboard/assets/app.js"></script>\n',
    );
    await mkdir(path.join(dist, 'assets'));
    await writeFile(path.join(dist, 'assets', 'app.js'), 'window.__AIDEV_DASHBOARD__=1;\n');
    const server = await startTestServer({
      dashboardDir: dist,
      registerDefaultRoot: false,
      authenticateFetch: false,
    });
    try {
      const page = await fetch(`${server.url}/dashboard/`);
      expect(page.status).toBe(200);
      expect(page.headers.get('content-type')).toContain('text/html');
      const html = await page.text();
      expect(html).toContain('<title>AI DevTools</title>');
      expect(html).not.toContain(server.token);
      expect(html).not.toMatch(/token=/i);

      const asset = await fetch(`${server.url}/dashboard/assets/app.js`);
      expect(asset.status).toBe(200);
      expect(asset.headers.get('content-type')).toContain('javascript');
      expect(await asset.text()).toContain('__AIDEV_DASHBOARD__');

      const redirected = await fetch(`${server.url}/`, { redirect: 'manual' });
      expect(redirected.status).toBe(302);
      expect(redirected.headers.get('location')).toBe('/dashboard/');
    } finally {
      await server.close();
    }
  });

  it('returns 404 with build instructions when the dashboard is not built', async () => {
    const missing = path.join(tmpdir(), 'aidev-missing-dashboard', 'dist');
    const server = await startTestServer({
      dashboardDir: missing,
      registerDefaultRoot: false,
      authenticateFetch: false,
    });
    try {
      const response = await fetch(`${server.url}/dashboard/`);
      expect(response.status).toBe(404);
      expect(await response.text()).toMatch(/Build @aidev\/dashboard/);
    } finally {
      await server.close();
    }
  });
});
