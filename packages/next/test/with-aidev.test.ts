import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensureGateway: vi.fn(async () => true),
  readMachineToken: vi.fn(async () => 'machine-token'),
  registerProject: vi.fn(async () => ({ projectId: 'proj_1', browserToken: 'tok_browser' })),
}));

vi.mock('@aidev/vite', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aidev/vite')>();
  return {
    ...actual,
    ensureGateway: mocks.ensureGateway,
    readMachineToken: mocks.readMachineToken,
    registerProject: mocks.registerProject,
  };
});

import { withAidev } from '../src/index.js';

const temps: string[] = [];

describe('withAidev', () => {
  beforeEach(() => {
    vi.stubEnv('GATEWAY_URL', undefined);
    vi.stubEnv('PORT', undefined);
    mocks.ensureGateway.mockReset();
    mocks.readMachineToken.mockReset();
    mocks.registerProject.mockReset();
    mocks.ensureGateway.mockResolvedValue(true);
    mocks.readMachineToken.mockResolvedValue('machine-token');
    mocks.registerProject.mockResolvedValue({ projectId: 'proj_1', browserToken: 'tok_browser' });
    delete process.env.NEXT_PUBLIC_AIDEV_GATEWAY_URL;
    delete process.env.NEXT_PUBLIC_AIDEV_PROJECT_ID;
    delete process.env.NEXT_PUBLIC_AIDEV_BROWSER_TOKEN;
    delete process.env.NEXT_PUBLIC_AIDEV_PROJECT_NAME;
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('returns unchanged config in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const input = { reactStrictMode: true };
    const result = await withAidev(input);
    expect(result).toBe(input);
    expect(result.webpack).toBeUndefined();
    expect(result.env).toBeUndefined();
    expect(mocks.ensureGateway).not.toHaveBeenCalled();
  });

  it('adds the loader rule and env vars in development', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const root = await tempProject();
    const result = await withAidev(
      { reactStrictMode: true },
      { root, origin: 'http://localhost:3000' },
    );
    expect(result.env).toMatchObject({
      NEXT_PUBLIC_AIDEV_GATEWAY_URL: 'http://127.0.0.1:4100',
      NEXT_PUBLIC_AIDEV_PROJECT_ID: 'proj_1',
      NEXT_PUBLIC_AIDEV_BROWSER_TOKEN: 'tok_browser',
      NEXT_PUBLIC_AIDEV_PROJECT_NAME: 'demo-next',
    });
    expect(mocks.registerProject).toHaveBeenCalledWith(
      expect.objectContaining({
        root,
        origin: 'http://localhost:3000',
        token: 'machine-token',
      }),
    );

    const webpackConfig = { module: { rules: [] as unknown[] } };
    const webpack = result.webpack;
    expect(typeof webpack).toBe('function');
    const next = webpack?.(webpackConfig as never, { dev: true, isServer: false } as never) as {
      module: { rules: Array<{ test?: RegExp; exclude?: RegExp; enforce?: string; use?: { loader?: string } }> };
    };
    const rule = next.module.rules.find((item) => item.enforce === 'pre' && item.test?.test('App.tsx'));
    expect(rule?.exclude?.test('node_modules/pkg/Button.tsx')).toBe(true);
    expect(rule?.use?.loader).toMatch(/loader\.(js|ts)$/);
    expect(rule?.test?.test('src/App.jsx')).toBe(true);
    expect(rule?.test?.test('src/util.ts')).toBe(false);

    const productionWebpack = webpack?.(
      { module: { rules: [] } } as never,
      { dev: false, isServer: false } as never,
    ) as { module: { rules: unknown[] } };
    expect(productionWebpack.module.rules).toHaveLength(0);

    expect(result.turbopack?.rules?.['*.tsx']).toEqual(
      expect.objectContaining({
        as: '*.tsx',
        loaders: expect.arrayContaining([expect.objectContaining({ loader: expect.stringMatching(/loader/) })]),
      }),
    );
  });

  it('uses an origin override when registering', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const root = await tempProject();
    await withAidev({}, { root, origin: 'http://127.0.0.1:3001', gatewayUrl: 'http://127.0.0.1:4101' });
    expect(mocks.registerProject).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: 'http://127.0.0.1:3001',
        gatewayUrl: 'http://127.0.0.1:4101',
      }),
    );
  });
});

async function tempProject(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'aidev-next-'));
  temps.push(root);
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'demo-next' }), 'utf8');
  return root;
}
