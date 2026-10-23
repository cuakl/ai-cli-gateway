import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BROWSER_TOKENS_FILENAME } from '../src/projects/registry.js';
import { isRecord, postJson, startTestServer } from './helpers.js';

const dirs: string[] = [];

describe('persisted browser tokens', () => {
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('reuses the same token after the gateway process restarts', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'aidev-token-persist-'));
    const root = await mkdtemp(path.join(tmpdir(), 'aidev-token-root-'));
    dirs.push(home, root);

    const first = await startTestServer({ home, registerDefaultRoot: false, authenticateFetch: false });
    const headers = { authorization: `Bearer ${first.token}` };
    let projectId = '';
    let browserToken = '';
    try {
      const registered = await postJson(
        `${first.url}/api/v1/projects/register`,
        { root, origin: 'http://localhost:5173' },
        { headers },
      );
      expect(registered.status).toBe(200);
      expect(isRecord(registered.body)).toBe(true);
      if (!isRecord(registered.body)) return;
      projectId = String(registered.body.projectId);
      browserToken = String(registered.body.browserToken);
      const info = await stat(path.join(home, BROWSER_TOKENS_FILENAME));
      expect(info.mode & 0o777).toBe(0o600);
    } finally {
      await first.close();
    }

    const second = await startTestServer({ home, registerDefaultRoot: false, authenticateFetch: false });
    try {
      const again = await postJson(
        `${second.url}/api/v1/projects/register`,
        { root, origin: 'http://localhost:5173' },
        { headers: { authorization: `Bearer ${second.token}` } },
      );
      expect(again.status).toBe(200);
      expect(isRecord(again.body)).toBe(true);
      if (!isRecord(again.body)) return;
      expect(again.body.projectId).toBe(projectId);
      expect(again.body.browserToken).toBe(browserToken);

      const threads = await fetch(`${second.url}/api/v1/threads?projectId=${projectId}`, {
        headers: { authorization: `Bearer ${browserToken}` },
      });
      expect(threads.status).toBe(200);
    } finally {
      await second.close();
    }
  });
});
