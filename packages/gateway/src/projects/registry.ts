import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { Project } from '@aidev/protocol';
import { generateToken, readConfig, writeConfig, writeSecretFile } from '../home.js';
import { sameDevOrigin } from './origin.js';

/** Project-scoped browser tokens, mode 0600, so script-tag snippets survive a restart. */
export const BROWSER_TOKENS_FILENAME = 'browser-tokens.json';

export function projectIdFor(root: string): string {
  return createHash('sha256').update(root).digest('hex');
}

export function tokensEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

interface BrowserGrant {
  projectId: string;
  allowRemoteShell: boolean;
}

/**
 * Registered project roots (persisted in config.json) and browser tokens
 * (`AIDEV_HOME/browser-tokens.json`, mode 0600). Tokens are also kept in
 * memory so a grant can be checked without a disk read.
 */
export class ProjectRegistry {
  private readonly projects = new Map<string, Project>();
  private readonly grants = new Map<string, BrowserGrant>();
  private readonly tokenByProject = new Map<string, string>();
  private readonly trustedOrigins = new Set<string>();

  constructor(private readonly home: string) {}

  async load(): Promise<void> {
    const config = await readConfig(this.home);
    this.projects.clear();
    for (const project of config.projects ?? []) {
      this.projects.set(project.id, project);
    }
    await this.loadBrowserTokens();
  }

  list(): Project[] {
    return [...this.projects.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  get(id: string): Project | undefined {
    return this.projects.get(id);
  }

  roots(): string[] {
    return this.list().map((project) => project.root);
  }

  /** Dashboard origin, or any other origin trusted for this process only. */
  trustOrigin(origin: string): void {
    this.trustedOrigins.add(origin);
  }

  allowsOrigin(origin: string): boolean {
    for (const allowed of this.trustedOrigins) {
      if (sameDevOrigin(allowed, origin)) return true;
    }
    for (const project of this.projects.values()) {
      if (project.origins.some((allowed) => sameDevOrigin(allowed, origin))) return true;
    }
    return false;
  }

  browserGrant(token: string): BrowserGrant | undefined {
    return this.grants.get(token);
  }

  /**
   * Register `root` (realpath) and optionally add `origin` to its allowlist.
   * The same root always yields the same project id and the same browser token
   * (in this process and after a restart, from browser-tokens.json).
   */
  async register(input: {
    root: string;
    origin?: string;
    allowRemoteShell?: boolean;
  }): Promise<{ project: Project; browserToken: string }> {
    const root = await realpath(path.resolve(input.root));
    const id = projectIdFor(root);
    const now = Date.now();
    const existing = this.projects.get(id);
    const origins = new Set(existing?.origins ?? []);
    if (input.origin) origins.add(input.origin);
    const project: Project = {
      id,
      root,
      name: await readProjectName(root),
      origins: [...origins],
      createdAt: existing?.createdAt ?? now,
      lastSeenAt: now,
    };
    this.projects.set(id, project);

    let browserToken = this.tokenByProject.get(id);
    if (!browserToken) {
      browserToken = generateToken();
      this.tokenByProject.set(id, browserToken);
    }
    const previous = this.grants.get(browserToken);
    this.grants.set(browserToken, {
      projectId: id,
      allowRemoteShell: input.allowRemoteShell ?? previous?.allowRemoteShell ?? false,
    });
    await this.persist();
    await this.persistBrowserTokens();
    return { project, browserToken };
  }

  private async persist(): Promise<void> {
    const config = await readConfig(this.home);
    await writeConfig(this.home, { ...config, projects: this.list() });
  }

  private async loadBrowserTokens(): Promise<void> {
    this.grants.clear();
    this.tokenByProject.clear();
    let raw = '';
    try {
      raw = await readFile(path.join(this.home, BROWSER_TOKENS_FILENAME), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
    for (const [projectId, token] of Object.entries(parsed as Record<string, unknown>)) {
      if (!this.projects.has(projectId)) continue;
      if (typeof token !== 'string' || !token.trim()) continue;
      const value = token.trim();
      this.tokenByProject.set(projectId, value);
      this.grants.set(value, { projectId, allowRemoteShell: false });
    }
  }

  private async persistBrowserTokens(): Promise<void> {
    const tokens: Record<string, string> = {};
    for (const [projectId, token] of this.tokenByProject) {
      if (this.projects.has(projectId)) tokens[projectId] = token;
    }
    await writeSecretFile(this.home, BROWSER_TOKENS_FILENAME, `${JSON.stringify(tokens, null, 2)}\n`);
  }
}

async function readProjectName(root: string): Promise<string> {
  try {
    const raw = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as { name?: unknown };
    if (typeof raw.name === 'string' && raw.name.trim()) return raw.name.trim();
  } catch {
    // A directory without package.json is named by its basename.
  }
  const base = path.basename(root);
  return base || root;
}
