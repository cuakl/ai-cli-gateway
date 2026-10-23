import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_GATEWAY_URL,
  ensureGateway,
  readMachineToken,
  registerProject,
} from '@aidev/vite';
import type { NextConfig } from 'next';
import { DEFAULT_ORIGIN, ENV } from './brand.js';
import { readNextVersion, supportsExperimentalTurbo, supportsTurbopackRules } from './next-version.js';
import { readProjectName } from './project-name.js';

export { DEFAULT_GATEWAY_URL, DEFAULT_ORIGIN, ENV, GLOBAL_CONFIG_KEY } from './brand.js';

export interface AidevNextOptions {
  /** Gateway origin. Defaults to `GATEWAY_URL` or `http://127.0.0.1:4100`. */
  gatewayUrl?: string;
  /**
   * Dev-server origin registered with the gateway.
   * Defaults to `http://localhost:$PORT` (Next sets PORT from `-p`), else `http://localhost:3000`.
   */
  origin?: string;
  /** Project root. Defaults to `process.cwd()`. */
  root?: string;
  /**
   * Spawn `aidev start --detach` when `/health` fails. Defaults to true.
   */
  autoStart?: boolean;
  /** Stamp `data-loc` onto JSX in dev. Defaults to true. */
  injectDataLoc?: boolean;
  /** Turn the helper off even in development. Defaults to true. */
  enabled?: boolean;
}

export interface AidevNextEnv {
  NEXT_PUBLIC_AIDEV_GATEWAY_URL: string;
  NEXT_PUBLIC_AIDEV_PROJECT_ID?: string;
  NEXT_PUBLIC_AIDEV_BROWSER_TOKEN?: string;
  NEXT_PUBLIC_AIDEV_PROJECT_NAME?: string;
}

type WebpackConfig = {
  module?: {
    rules?: unknown[];
  };
};

type WebpackContext = {
  dev: boolean;
  isServer: boolean;
};

type TurboRule = {
  loaders: Array<string | { loader: string; options?: { root?: string } }>;
  as: string;
};

export type DataLocTurboRules = Record<string, TurboRule>;

/**
 * Next.js config wrapper. In production the input is returned unchanged.
 * In development it auto-starts the gateway, registers the project, injects
 * `NEXT_PUBLIC_AIDEV_*` env, and wires the `data-loc` loader.
 *
 * Next.js 12.1+ awaits a Promise default export, so
 * `export default withAidev(nextConfig)` is valid.
 */
export async function withAidev(
  nextConfig: NextConfig = {},
  options: AidevNextOptions = {},
): Promise<NextConfig> {
  if (process.env.NODE_ENV === 'production' || options.enabled === false) {
    return nextConfig;
  }

  const root = options.root ?? process.cwd();
  const gatewayUrl = (options.gatewayUrl ?? process.env.GATEWAY_URL ?? DEFAULT_GATEWAY_URL).replace(
    /\/$/,
    '',
  );
  const origin = options.origin ?? (process.env.PORT ? `http://localhost:${process.env.PORT}` : DEFAULT_ORIGIN);
  const autoStart = options.autoStart !== false;
  const projectName = readProjectName(root);
  const env = await registerDevEnv({ gatewayUrl, root, origin, autoStart, projectName });
  assignProcessEnv(env);

  const stamp = options.injectDataLoc !== false;
  const loaderPath = resolveLoaderPath();
  const previousWebpack = nextConfig.webpack;
  const nextVersion = readNextVersion(root);
  const turboRules = stamp ? dataLocTurboRules(loaderPath, root) : undefined;

  const wrapped: NextConfig = {
    ...nextConfig,
    env: {
      ...nextConfig.env,
      ...env,
    },
    webpack: ((config: WebpackConfig, ctx: WebpackContext) => {
      if (ctx.dev && stamp) {
        config.module ??= {};
        config.module.rules ??= [];
        config.module.rules.push({
          test: /\.[jt]sx$/,
          exclude: /node_modules/,
          enforce: 'pre',
          use: {
            loader: loaderPath,
            options: { root },
          },
        });
      }
      if (typeof previousWebpack === 'function') {
        return previousWebpack(config as never, ctx as never);
      }
      return config;
    }) as NextConfig['webpack'],
  };

  if (stamp && turboRules && supportsTurbopackRules(nextVersion)) {
    wrapped.turbopack = {
      ...nextConfig.turbopack,
      rules: {
        ...turboRules,
        ...nextConfig.turbopack?.rules,
      },
    };
  }

  if (stamp && turboRules && supportsExperimentalTurbo(nextVersion)) {
    const previousExperimental = (nextConfig.experimental ?? {}) as Record<string, unknown>;
    const previousTurbo = (previousExperimental.turbo ?? {}) as { rules?: Record<string, unknown> };
    wrapped.experimental = {
      ...previousExperimental,
      turbo: {
        ...previousTurbo,
        rules: {
          ...turboRules,
          ...previousTurbo.rules,
        },
      },
    } as NextConfig['experimental'];
  }

  return wrapped;
}

export function dataLocTurboRules(loaderPath: string, root: string): DataLocTurboRules {
  const entry: TurboRule = {
    loaders: [{ loader: loaderPath, options: { root } }],
    as: '*.tsx',
  };
  return {
    '*.jsx': { ...entry, as: '*.jsx' },
    '*.tsx': entry,
  };
}

export function resolveLoaderPath(): string {
  try {
    return createRequire(import.meta.url).resolve('@aidev/next/loader');
  } catch {
    return fileURLToPath(new URL('./loader.js', import.meta.url));
  }
}

export default withAidev;

async function registerDevEnv(options: {
  gatewayUrl: string;
  root: string;
  origin: string;
  autoStart: boolean;
  projectName: string | undefined;
}): Promise<AidevNextEnv> {
  const env: AidevNextEnv = {
    [ENV.gatewayUrl]: options.gatewayUrl,
    ...(options.projectName ? { [ENV.projectName]: options.projectName } : {}),
  };
  const up = await ensureGateway({
    gatewayUrl: options.gatewayUrl,
    autoStart: options.autoStart,
  });
  if (!up) return env;
  const token = await readMachineToken();
  if (!token) return env;
  const registered = await registerProject({
    gatewayUrl: options.gatewayUrl,
    root: options.root,
    origin: options.origin,
    token,
  });
  if (!registered) return env;
  env[ENV.projectId] = registered.projectId;
  env[ENV.browserToken] = registered.browserToken;
  return env;
}

function assignProcessEnv(env: AidevNextEnv): void {
  process.env[ENV.gatewayUrl] = env.NEXT_PUBLIC_AIDEV_GATEWAY_URL;
  if (env.NEXT_PUBLIC_AIDEV_PROJECT_ID) process.env[ENV.projectId] = env.NEXT_PUBLIC_AIDEV_PROJECT_ID;
  if (env.NEXT_PUBLIC_AIDEV_BROWSER_TOKEN) {
    process.env[ENV.browserToken] = env.NEXT_PUBLIC_AIDEV_BROWSER_TOKEN;
  }
  if (env.NEXT_PUBLIC_AIDEV_PROJECT_NAME) {
    process.env[ENV.projectName] = env.NEXT_PUBLIC_AIDEV_PROJECT_NAME;
  }
}
