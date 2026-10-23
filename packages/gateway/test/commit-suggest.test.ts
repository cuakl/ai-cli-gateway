import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createStreamEvent, type PromptOptions } from '@aidev/protocol';
import { simpleGit } from 'simple-git';
import { AuthService } from '../src/auth/principal.js';
import { ensureHome, readConfig } from '../src/home.js';
import { ProjectRegistry } from '../src/projects/registry.js';
import { SessionRegistry } from '../src/sessions/registry.js';
import { ActiveRuns } from '../src/threads/active.js';
import { DEFAULT_MAX_CONCURRENT_RUNS, RunScheduler } from '../src/threads/scheduler.js';
import { FileThreadStore } from '../src/threads/store.js';
import type { ServerDeps } from '../src/types.js';
import { sanitizeCommitMessage, suggestCommitMessage } from '../src/workspace/commit-suggest.js';
import { WorkspaceHub } from '../src/ws/hub.js';
import { runtimeFor, ScriptedAdapter } from './scripted-adapter.js';

const roots: string[] = [];
const registries: SessionRegistry[] = [];

describe('commit.suggest', () => {
  afterEach(async () => {
    for (const registry of registries.splice(0)) registry.dispose();
    await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('strips fences and quotes from the adapter reply and runs outside the project', async () => {
    const dir = await createRepo();
    await writeFile(path.join(dir, 'app.txt'), 'hello\nworld\n');
    const seen: PromptOptions[] = [];
    const adapter = new ScriptedAdapter('cursor', async ({ options, onEvent, sessionId }) => {
      seen.push(options);
      onEvent(createStreamEvent(sessionId, 'chunk', { text: '```\n"feat: add world"\n```' }));
      onEvent(createStreamEvent(sessionId, 'done', { durationMs: 2 }));
      return { exitCode: 0, summary: 'feat: add world' };
    });
    const { deps, projectId } = await buildDeps(adapter, dir);
    const message = await suggestCommitMessage(deps, { kind: 'machine' }, dir, projectId, ['app.txt']);
    expect(message).toBe('feat: add world');
    expect(seen[0]?.cwd).toBeTruthy();
    expect(seen[0]?.cwd).not.toBe(dir);
    expect(seen[0]?.cwd.startsWith(path.join(deps.home, 'scratch'))).toBe(true);
  });

  it('sanitizeCommitMessage drops fences and surrounding quotes', () => {
    expect(sanitizeCommitMessage('```\nfeat: tidy\n```')).toBe('feat: tidy');
    expect(sanitizeCommitMessage('"feat: tidy"')).toBe('feat: tidy');
    expect(sanitizeCommitMessage("```ts\n'feat: tidy'\n```")).toBe('feat: tidy');
  });
});

async function createRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'ai-devtools-suggest-'));
  roots.push(dir);
  const git = simpleGit(dir);
  await git.init(['-b', 'main']);
  await git.addConfig('user.name', 'DevTools Test');
  await git.addConfig('user.email', 'devtools@example.com');
  await writeFile(path.join(dir, 'app.txt'), 'hello\n');
  await git.add('.');
  await git.commit('init');
  return dir;
}

async function buildDeps(adapter: ScriptedAdapter, root: string): Promise<{ deps: ServerDeps; projectId: string }> {
  const home = await mkdtemp(path.join(tmpdir(), 'aidev-home-'));
  roots.push(home);
  const ensured = await ensureHome(home);
  const config = await readConfig(home);
  const projects = new ProjectRegistry(home);
  await projects.load();
  const registered = await projects.register({ root });
  const registry = new SessionRegistry();
  registries.push(registry);
  const deps: ServerDeps = {
    registry,
    runtime: runtimeFor({ cursor: adapter }),
    home,
    projects,
    auth: new AuthService(ensured.token, projects, config.inferenceTokens ?? []),
    threads: new FileThreadStore(home),
    runs: new ActiveRuns(),
    scheduler: new RunScheduler(config.maxConcurrentRuns ?? DEFAULT_MAX_CONCURRENT_RUNS),
    hub: new WorkspaceHub(),
    config,
    bindHost: '127.0.0.1',
    root,
  };
  return { deps, projectId: registered.project.id };
}
