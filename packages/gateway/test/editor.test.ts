import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkspaceServerMessage } from '@aidev/protocol';
import { WebSocket } from 'ws';
import { defaultConfig, ensureHome, writeConfig } from '../src/home.js';
import {
  EditorUnavailableError,
  openInEditor,
  resolveEditorLaunch,
  setEditorTestHooks,
} from '../src/workspace/editor.js';
import { isRecord, postJson, startTestServer, type TestServer } from './helpers.js';
import { runtimeFor, ScriptedAdapter } from './scripted-adapter.js';

const dirs: string[] = [];
const servers: TestServer[] = [];
const originalPath = process.env.PATH;
const originalVisual = process.env.VISUAL;
const originalEditor = process.env.EDITOR;

describe('open in editor', () => {
  afterEach(async () => {
    setEditorTestHooks(null);
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    if (originalVisual === undefined) delete process.env.VISUAL;
    else process.env.VISUAL = originalVisual;
    if (originalEditor === undefined) delete process.env.EDITOR;
    else process.env.EDITOR = originalEditor;
    await Promise.all(servers.splice(0).map((server) => server.close()));
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('builds cursor -g argv from auto when cursor is on PATH', async () => {
    const cursor = '/opt/fake/cursor';
    const file = '/work/app/src/Hero.tsx';
    await expect(
      resolveEditorLaunch({
        editor: 'auto',
        file,
        line: 11,
        column: 4,
        which: async (name) => (name === 'cursor' ? cursor : null),
      }),
    ).resolves.toEqual({ command: cursor, args: ['-g', `${file}:11:4`] });
  });

  it('falls back to code -g, then VISUAL with the file path only', async () => {
    const code = '/opt/fake/code';
    const file = '/work/app/src/Hero.tsx';
    await expect(
      resolveEditorLaunch({
        editor: 'auto',
        file,
        line: 3,
        which: async (name) => (name === 'code' ? code : null),
      }),
    ).resolves.toEqual({ command: code, args: ['-g', `${file}:3`] });

    const visual = '/opt/fake/vim';
    await expect(
      resolveEditorLaunch({
        editor: 'auto',
        file,
        which: async (name) => (name === 'vim' ? visual : null),
        env: { VISUAL: 'vim' },
      }),
    ).resolves.toEqual({ command: visual, args: [file] });
  });

  it('resolves a PATH script as the cursor launcher without spawning it', async () => {
    const bin = await tempDir('editor-bin-');
    const cursor = path.join(bin, 'cursor');
    await writeFile(cursor, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    await chmod(cursor, 0o755);
    process.env.PATH = `${bin}${path.delimiter}${process.env.PATH ?? ''}`;
    const file = '/work/app/App.tsx';
    const launch = await resolveEditorLaunch({ editor: 'auto', file, line: 2, column: 0 });
    expect(launch.command).toBe(cursor);
    expect(launch.args).toEqual(['-g', `${file}:2:0`]);
  });

  it('rejects a path that leaves the project before launching', async () => {
    const root = await tempDir('editor-root-');
    const launched: { command: string; args: string[] }[] = [];
    await expect(
      openInEditor({
        root,
        file: '../secret.txt',
        which: async () => '/opt/fake/cursor',
        launch: (command, args) => launched.push({ command, args }),
      }),
    ).rejects.toMatchObject({ code: 'path_escape' });
    expect(launched).toEqual([]);
  });

  it('POST /open rejects path_escape and builds argv through an injected launcher', async () => {
    const root = await tempDir('editor-http-');
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'Hero.tsx'), 'export {}\n');
    const launched: { command: string; args: string[] }[] = [];
    setEditorTestHooks({
      which: async (name) => (name === 'cursor' ? '/opt/fake/cursor' : null),
      launch: (command, args) => launched.push({ command, args }),
    });
    const server = await startProject(root);
    const project = await register(server, root);
    const escaped = await postJson(
      `${server.url}/api/v1/projects/${project.id}/open`,
      { file: '../secret.txt' },
      { headers: { authorization: `Bearer ${project.token}` } },
    );
    expect(escaped.status).toBe(400);
    expect(escaped.body).toMatchObject({ error: 'path_escape' });
    expect(launched).toEqual([]);

    const opened = await postJson(
      `${server.url}/api/v1/projects/${project.id}/open`,
      { file: 'src/Hero.tsx', line: 11, column: 4 },
      { headers: { authorization: `Bearer ${project.token}` } },
    );
    expect(opened.status).toBe(200);
    expect(opened.body).toMatchObject({ file: 'src/Hero.tsx' });
    expect(launched).toEqual([
      { command: '/opt/fake/cursor', args: ['-g', `${path.join(root, 'src', 'Hero.tsx')}:11:4`] },
    ]);
  });

  it('opens from the workspace socket and reports editor_unavailable', async () => {
    const root = await tempDir('editor-ws-');
    await writeFile(path.join(root, 'App.tsx'), 'export {}\n');
    const launched: string[][] = [];
    setEditorTestHooks({
      which: async (name) => (name === 'cursor' ? '/opt/fake/cursor' : null),
      launch: (_command, args) => launched.push(args),
    });
    const server = await startProject(root);
    const project = await register(server, root);
    const socket = await openSocket(projectWs(server, project.id, project.token));
    const messages = collect(socket);
    try {
      socket.send(
        JSON.stringify({
          type: 'editor.open',
          requestId: 'e1',
          file: 'App.tsx',
          line: 1,
        }),
      );
      await messages.waitFor((items) => items.some((item) => item.requestId === 'e1'));
      expect(messages.items.find((item) => item.requestId === 'e1')).toMatchObject({
        type: 'editor.open.result',
        file: 'App.tsx',
      });
      expect(launched).toEqual([['-g', `${path.join(root, 'App.tsx')}:1`]]);
    } finally {
      await closeSocket(socket);
    }

    setEditorTestHooks({
      which: async () => null,
      launch: () => {
        throw new Error('must not launch');
      },
    });
    delete process.env.VISUAL;
    delete process.env.EDITOR;
    const missing = await postJson(
      `${server.url}/api/v1/projects/${project.id}/open`,
      { file: 'App.tsx' },
      { headers: { authorization: `Bearer ${server.token}` } },
    );
    expect(missing.status).toBe(422);
    expect(missing.body).toMatchObject({ error: 'editor_unavailable' });
    await expect(
      resolveEditorLaunch({ editor: 'auto', file: '/work/x.ts', which: async () => null, env: {} }),
    ).rejects.toBeInstanceOf(EditorUnavailableError);
  });

  it('uses a custom editor command from config.json', async () => {
    const root = await tempDir('editor-custom-');
    await writeFile(path.join(root, 'App.tsx'), 'export {}\n');
    const home = await tempDir('editor-home-');
    await ensureHome(home);
    await writeConfig(home, { ...defaultConfig(), editor: 'myeditor' });
    const launched: { command: string; args: string[] }[] = [];
    setEditorTestHooks({
      which: async (name) => (name === 'myeditor' ? '/opt/fake/myeditor' : null),
      launch: (command, args) => launched.push({ command, args }),
    });
    const server = await startTestServer({
      home,
      root,
      registerDefaultRoot: false,
      authenticateFetch: false,
      runtime: runtimeFor({
        cursor: new ScriptedAdapter('cursor', async () => ({ exitCode: 0, summary: '' })),
      }),
    });
    servers.push(server);
    const project = await register(server, root);
    const opened = await postJson(
      `${server.url}/api/v1/projects/${project.id}/open`,
      { file: 'App.tsx' },
      { headers: { authorization: `Bearer ${project.token}` } },
    );
    expect(opened.status).toBe(200);
    expect(launched).toEqual([{ command: '/opt/fake/myeditor', args: [path.join(root, 'App.tsx')] }]);
  });
});

async function startProject(root: string): Promise<TestServer> {
  const server = await startTestServer({
    root,
    registerDefaultRoot: false,
    authenticateFetch: false,
    runtime: runtimeFor({
      cursor: new ScriptedAdapter('cursor', async () => ({ exitCode: 0, summary: '' })),
    }),
  });
  servers.push(server);
  return server;
}

async function register(server: TestServer, root: string): Promise<{ id: string; token: string }> {
  const response = await postJson(
    `${server.url}/api/v1/projects/register`,
    { root, origin: 'http://localhost:5173' },
    { headers: { authorization: `Bearer ${server.token}` } },
  );
  if (
    !isRecord(response.body) ||
    typeof response.body.projectId !== 'string' ||
    typeof response.body.browserToken !== 'string'
  ) {
    throw new Error(`register failed: ${JSON.stringify(response.body)}`);
  }
  return { id: response.body.projectId, token: response.body.browserToken };
}

function projectWs(server: TestServer, projectId: string, token: string): string {
  const url = new URL(server.url);
  url.protocol = 'ws:';
  url.pathname = `/api/v1/projects/${projectId}/ws`;
  url.searchParams.set('token', token);
  return url.toString();
}

async function tempDir(prefix: string): Promise<string> {
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
}

function openSocket(url: string): Promise<WebSocket> {
  const socket = new WebSocket(url);
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve(socket));
    socket.once('error', (error) => reject(error));
  });
}

function closeSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => {
    socket.once('close', () => resolve());
    socket.close();
  });
}

function collect(socket: WebSocket): {
  items: WorkspaceServerMessage[];
  waitFor: (ready: (items: WorkspaceServerMessage[]) => boolean) => Promise<void>;
} {
  const items: WorkspaceServerMessage[] = [];
  socket.on('message', (data) => {
    items.push(JSON.parse(String(data)) as WorkspaceServerMessage);
  });
  return {
    items,
    async waitFor(ready) {
      const started = Date.now();
      while (!ready(items)) {
        if (Date.now() - started > 5_000) throw new Error(`messages: ${JSON.stringify(items)}`);
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
    },
  };
}
