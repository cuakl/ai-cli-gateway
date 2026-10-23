import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { providerSetup } from '@aidev/adapters';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { ensureHome, readConfig, writeConfig } from '../src/home.js';
import { isRecord, postJson, requestJson, startTestServer, type TestServer } from './helpers.js';
import { runtimeFor, ScriptedAdapter } from './scripted-adapter.js';

const dirs: string[] = [];
const servers: TestServer[] = [];

describe('auth, CORS, and project scope', () => {
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('keeps /health minimal and rejects /api/v1 without a token', async () => {
    const server = await bareServer();
    const health = await requestJson(`${server.url}/health`);
    expect(health.status).toBe(200);
    expect(health.body).toEqual({ status: 'ok', version: expect.any(String) });
    expect(isRecord(health.body) && 'availableProviders' in health.body).toBe(false);

    const status = await requestJson(`${server.url}/api/v1/status`);
    expect(status.status).toBe(401);
    expect(status.body).toEqual({ error: 'unauthorized' });

    const authed = await requestJson(`${server.url}/api/v1/status`, {
      headers: { authorization: `Bearer ${server.token}` },
    });
    expect(authed.status).toBe(200);
    expect(isRecord(authed.body) && authed.body.status).toBe('ok');
    expect(isRecord(authed.body) && Array.isArray(authed.body.providers)).toBe(true);
    if (!isRecord(authed.body) || !Array.isArray(authed.body.providers)) return;
    const providers = authed.body.providers;
    expect(providers.map((item) => (isRecord(item) ? item.provider : null))).toEqual([
      'cursor',
      'antigravity',
      'claude',
      'codex',
    ]);
    expect(providers[0]).toMatchObject({
      provider: 'cursor',
      available: true,
      binaryPath: '/mock/bin/cursor',
      version: null,
      verified: true,
      modes: ['agent', 'ask', 'plan'],
      models: [],
      supportsResume: true,
      supportsImages: false,
      supportsJsonSchema: false,
      supportsSystemPrompt: true,
    });
    expect(providers[0]).not.toHaveProperty('setup');
    expect(providers[1]).toMatchObject({
      provider: 'antigravity',
      available: false,
      binaryPath: null,
      verified: false,
      modes: ['agent'],
      supportsResume: false,
      supportsSystemPrompt: false,
      setup: providerSetup('antigravity'),
    });
    expect(providers[2]).toMatchObject({
      provider: 'claude',
      available: false,
      verified: true,
      modes: ['agent', 'ask', 'plan'],
      models: [
        { id: 'sonnet', label: 'sonnet' },
        { id: 'opus', label: 'opus' },
        { id: 'haiku', label: 'haiku' },
      ],
      supportsResume: true,
      supportsImages: false,
      supportsJsonSchema: false,
      supportsSystemPrompt: true,
      setup: providerSetup('claude'),
    });
    expect(providers[3]).toMatchObject({
      provider: 'codex',
      available: false,
      verified: false,
      modes: ['agent', 'ask'],
      models: [],
      supportsResume: false,
      supportsSystemPrompt: false,
      setup: providerSetup('codex'),
    });
  });

  it('omits ACAO for an unknown origin and rejects that origin on the WebSocket', async () => {
    const server = await bareServer();
    const root = await tempDir('cors-root-');
    const registered = await postJson(
      `${server.url}/api/v1/projects/register`,
      { root, origin: 'http://localhost:5173' },
      { headers: { authorization: `Bearer ${server.token}` } },
    );
    expect(registered.status).toBe(200);

    const evil = await postJson(
      `${server.url}/api/v1/projects/register`,
      { root, origin: 'http://localhost:5173' },
      { headers: { authorization: `Bearer ${server.token}`, origin: 'https://evil.example' } },
    );
    expect(evil.status).toBe(200);
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();

    const allowed = await requestJson(`${server.url}/health`, {
      headers: { origin: 'http://localhost:5173' },
    });
    expect(allowed.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');

    const failure = await rejectSocket(
      `${server.url.replace('http', 'ws')}/ws?token=${encodeURIComponent(server.token)}`,
      'https://evil.example',
    );
    expect(failure).toMatch(/403|4403/);
  });

  it('returns the same project id when a root is registered twice and can add an origin', async () => {
    const server = await bareServer();
    const root = await tempDir('idem-');
    const headers = { authorization: `Bearer ${server.token}` };
    const first = await postJson(`${server.url}/api/v1/projects/register`, { root, origin: 'http://localhost:5173' }, { headers });
    const second = await postJson(`${server.url}/api/v1/projects/register`, { root, origin: 'http://localhost:5174' }, { headers });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(isRecord(first.body)).toBe(true);
    expect(isRecord(second.body)).toBe(true);
    if (!isRecord(first.body) || !isRecord(second.body)) return;
    expect(first.body.projectId).toBe(second.body.projectId);
    expect(first.body.browserToken).toBe(second.body.browserToken);
    const listed = await requestJson(`${server.url}/api/v1/projects`, { headers });
    expect(listed.status).toBe(200);
    const projects = isRecord(listed.body) ? listed.body.projects : [];
    expect(Array.isArray(projects) && isRecord(projects[0]) && projects[0].origins).toEqual([
      'http://localhost:5173',
      'http://localhost:5174',
    ]);
  });

  it('stops a browser token from prompting or reading git in another project', async () => {
    const server = await bareServer();
    const rootA = await tempDir('proj-a-');
    const rootB = await tempDir('proj-b-');
    const headers = { authorization: `Bearer ${server.token}` };
    const projectA = await postJson(
      `${server.url}/api/v1/projects/register`,
      { root: rootA, origin: 'http://a.example' },
      { headers },
    );
    const projectB = await postJson(
      `${server.url}/api/v1/projects/register`,
      { root: rootB, origin: 'http://b.example' },
      { headers },
    );
    expect(isRecord(projectA.body) && isRecord(projectB.body)).toBe(true);
    if (!isRecord(projectA.body) || !isRecord(projectB.body)) return;
    const tokenA = String(projectA.body.browserToken);
    const idB = String(projectB.body.projectId);

    const escaped = await postJson(
      `${server.url}/api/v1/prompt`,
      { provider: 'cursor', cwd: rootB, prompt: 'hello' },
      { headers: { authorization: `Bearer ${tokenA}` } },
    );
    expect(escaped.status).toBe(400);
    expect(escaped.body).toMatchObject({ error: 'path_escape' });

    const projects = await requestJson(`${server.url}/api/v1/projects`, {
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(projects.status).toBe(403);

    const failure = await rejectSocket(
      `${server.url.replace('http', 'ws')}/api/v1/projects/${idB}/ws?token=${encodeURIComponent(tokenA)}`,
    );
    expect(failure).toMatch(/403|4403/);
  });

  it('lets only the machine token call POST /api/v1/shutdown', async () => {
    const home = await tempDir('shutdown-home-');
    await ensureHome(home);
    await writeConfig(home, { ...(await readConfig(home)), inferenceTokens: ['inf_shutdown'] });
    const server = await startTestServer({
      home,
      registerDefaultRoot: false,
      authenticateFetch: false,
      runtime: runtimeFor({
        cursor: new ScriptedAdapter('cursor', async () => ({ exitCode: 0, summary: '' })),
      }),
    });
    servers.push(server);
    const root = await tempDir('shutdown-root-');
    const registered = await postJson(
      `${server.url}/api/v1/projects/register`,
      { root, origin: 'http://localhost:5173' },
      { headers: { authorization: `Bearer ${server.token}` } },
    );
    expect(isRecord(registered.body)).toBe(true);
    if (!isRecord(registered.body)) return;
    const browser = await postJson(
      `${server.url}/api/v1/shutdown`,
      {},
      { headers: { authorization: `Bearer ${String(registered.body.browserToken)}` } },
    );
    expect(browser.status).toBe(403);
    const inference = await postJson(
      `${server.url}/api/v1/shutdown`,
      {},
      { headers: { authorization: `Bearer inf_shutdown` } },
    );
    expect(inference.status).toBe(403);
    const missing = await postJson(`${server.url}/api/v1/shutdown`, {});
    expect(missing.status).toBe(401);
    const stillUp = await requestJson(`${server.url}/health`);
    expect(stillUp.status).toBe(200);
  });

  it('refuses a project WebSocket and therefore a PTY when the token is missing', async () => {
    const server = await bareServer();
    const root = await tempDir('pty-root-');
    const registered = await postJson(
      `${server.url}/api/v1/projects/register`,
      { root, origin: 'http://localhost:5173' },
      { headers: { authorization: `Bearer ${server.token}` } },
    );
    expect(isRecord(registered.body)).toBe(true);
    if (!isRecord(registered.body)) return;
    const failure = await rejectSocket(
      `${server.url.replace('http', 'ws')}/api/v1/projects/${String(registered.body.projectId)}/ws`,
    );
    expect(failure).toMatch(/401|4401/);
  });
});

async function bareServer(): Promise<TestServer> {
  const server = await startTestServer({
    registerDefaultRoot: false,
    authenticateFetch: false,
    runtime: runtimeFor({
      cursor: new ScriptedAdapter('cursor', async () => ({ exitCode: 0, summary: '' })),
    }),
  });
  servers.push(server);
  return server;
}

async function tempDir(prefix: string): Promise<string> {
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
}

function rejectSocket(url: string, origin?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers: origin ? { origin } : {} });
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error('socket was not rejected'));
    }, 3_000);
    socket.once('unexpected-response', (_request, response) => {
      clearTimeout(timer);
      resolve(String(response.statusCode));
      socket.terminate();
    });
    socket.once('close', (code) => {
      clearTimeout(timer);
      resolve(String(code));
    });
    socket.once('error', () => {
      // `unexpected-response` and `close` carry the rejection.
    });
  });
}
