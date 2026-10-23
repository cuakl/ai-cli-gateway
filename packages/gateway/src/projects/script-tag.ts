import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface ScriptTagConfig {
  gatewayUrl: string;
  projectId: string;
  browserToken: string;
  projectName: string;
}

/** Ready-to-paste snippet for a non-Vite page. */
export function formatScriptTagSnippet(config: ScriptTagConfig): string {
  const json = JSON.stringify({
    gatewayUrl: config.gatewayUrl,
    projectId: config.projectId,
    browserToken: config.browserToken,
    projectName: config.projectName,
  }).replace(/</g, '\\u003c');
  return [
    '<script>',
    `  window.__AI_DEVTOOLS__ = ${json};`,
    '</script>',
    `<script src="${config.gatewayUrl}/overlay.js" defer></script>`,
  ].join('\n');
}

export async function projectNameOf(root: string): Promise<string> {
  try {
    const raw = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as { name?: unknown };
    if (typeof raw.name === 'string' && raw.name.trim()) return raw.name.trim();
  } catch {
    // A directory without package.json is named by its basename.
  }
  const base = path.basename(root);
  return base || root;
}
