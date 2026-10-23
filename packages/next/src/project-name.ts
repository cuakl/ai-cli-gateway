import { readFileSync } from 'node:fs';
import path from 'node:path';

export function readProjectName(root: string): string | undefined {
  try {
    const raw = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { name?: unknown };
    if (typeof raw.name !== 'string') return undefined;
    const name = raw.name.trim();
    return name || undefined;
  } catch {
    return undefined;
  }
}
