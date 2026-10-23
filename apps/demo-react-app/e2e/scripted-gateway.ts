import { readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  createStreamEvent,
  type PromptOptions,
  type ProviderCapabilities,
  type ProviderType,
  type UnifiedStreamEvent,
} from '@aidev/protocol';

const PROVIDERS = ['cursor', 'antigravity', 'claude', 'codex'] as const;

export interface EditingRuntime {
  runtime: {
    getAdapter: (provider: ProviderType) => {
      provider: ProviderType;
      isAvailable: () => Promise<boolean>;
      getBinaryPath: () => Promise<string>;
      execute: (
        options: PromptOptions,
        onEvent: (event: UnifiedStreamEvent) => void,
      ) => Promise<{ exitCode: number; summary: string }>;
      kill: (sessionId: string) => Promise<boolean>;
    };
    listProviders: () => Promise<Array<{ provider: ProviderType; available: boolean; binaryPath: string | null }>>;
    listCapabilities: () => Promise<ProviderCapabilities[]>;
  };
  prompts: string[];
}

/**
 * Gateway runtime that applies the demo's hero-button edit in `root`.
 * It refuses any other directory, so a missing cwd injection cannot touch the real repo.
 */
export function createEditingRuntime(root: string): EditingRuntime {
  const prompts: string[] = [];
  const allowed = path.resolve(root);

  const adapter = {
    provider: 'antigravity' as const,
    async isAvailable(): Promise<boolean> {
      return true;
    },
    async getBinaryPath(): Promise<string> {
      return '/mock/bin/antigravity';
    },
    async kill(_sessionId: string): Promise<boolean> {
      return true;
    },
    async execute(
      options: PromptOptions,
      onEvent: (event: UnifiedStreamEvent) => void,
    ): Promise<{ exitCode: number; summary: string }> {
      const sessionId = options.sessionId ?? 'e2e';
      prompts.push(options.prompt);
      const requested = await realpath(options.cwd);
      const allowedPath = await realpath(allowed);
      if (requested !== allowedPath) {
        throw new Error(`Refusing to edit ${options.cwd}`);
      }
      if (!options.prompt.includes('purple with rounded-full')) {
        throw new Error('The prompt did not ask for the hero button restyle');
      }
      // Stay running long enough for the Vite plugin to see project.activity and hold a full reload.
      await delay(500);
      await touchIndex(allowed);
      await delay(1_500);
      await paintHero(allowed);
      onEvent(createStreamEvent(sessionId, 'chunk', { text: 'Updating the hero button to purple.' }));
      onEvent(createStreamEvent(sessionId, 'file_edit', { filePath: 'src/components/Hero.tsx' }));
      onEvent(createStreamEvent(sessionId, 'file_edit', { filePath: 'src/styles.css' }));
      onEvent(createStreamEvent(sessionId, 'done', {}));
      return { exitCode: 0, summary: 'Updated the hero button' };
    },
  };

  return {
    prompts,
    runtime: {
      getAdapter(provider: ProviderType) {
        if (provider !== 'antigravity') throw new Error(`Provider ${provider} is not available`);
        return adapter;
      },
      async listProviders() {
        return PROVIDERS.map((provider) => ({
          provider,
          available: provider === 'antigravity',
          binaryPath: provider === 'antigravity' ? '/mock/bin/antigravity' : null,
        }));
      },
      async listCapabilities() {
        return PROVIDERS.map((provider) => scriptedCapability(provider));
      },
    },
  };
}

function scriptedCapability(provider: ProviderType): ProviderCapabilities {
  const available = provider === 'antigravity';
  const modes: ProviderCapabilities['modes'] =
    provider === 'antigravity' ? ['agent'] : provider === 'codex' ? ['agent', 'ask'] : ['agent', 'ask', 'plan'];
  const capability: ProviderCapabilities = {
    provider,
    available,
    binaryPath: available ? '/mock/bin/antigravity' : null,
    version: null,
    verified: provider === 'cursor' || provider === 'claude',
    modes,
    models: [],
    supportsResume: provider === 'cursor' || provider === 'claude',
    supportsImages: false,
    supportsJsonSchema: false,
    supportsSystemPrompt: provider === 'cursor' || provider === 'claude',
  };
  if (!available) capability.setup = ['Install the CLI and finish sign-in.'];
  return capability;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function touchIndex(root: string): Promise<void> {
  const file = path.join(root, 'index.html');
  const html = await readFile(file, 'utf8');
  const stamp = `<!-- reload ${Date.now()} -->`;
  const next = html.includes('<!-- reload ')
    ? html.replace(/<!-- reload .*? -->/, stamp)
    : `${html.trimEnd()}\n${stamp}\n`;
  await writeFile(file, next);
}

async function paintHero(root: string): Promise<void> {
  const heroPath = path.join(root, 'src', 'components', 'Hero.tsx');
  const cssPath = path.join(root, 'src', 'styles.css');
  const hero = await readFile(heroPath, 'utf8');
  const next = hero.replace(
    /(<button\b[^>]*\bid="hero-btn"[^>]*\bclassName=")primary(")/,
    '$1primary hero-purple$2',
  );
  if (next === hero) throw new Error(`Hero button class was not found in ${heroPath}`);
  await writeFile(heroPath, next);
  const css = await readFile(cssPath, 'utf8');
  if (css.includes('.hero-purple')) return;
  await writeFile(
    cssPath,
    `${css.trimEnd()}\n\n.hero-purple {\n  background: #6d28d9;\n  border-radius: 9999px;\n}\n`,
  );
}
