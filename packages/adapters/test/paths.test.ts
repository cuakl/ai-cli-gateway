import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PathEscapeError, confineToRoot, confineWorkspace } from '../src/index.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('path confinement', () => {
  it('keeps a cwd and a relative file inside the project root', async () => {
    const root = await tempDir();
    const nested = path.join(root, 'apps', 'demo');
    await mkdir(nested, { recursive: true });
    await writeFile(path.join(nested, 'App.tsx'), 'export {}\n');

    const confined = await confineWorkspace(root, nested, ['App.tsx', 'src/New.tsx']);
    expect(confined.cwd).toBe(await realpath(nested));
    expect(confined.files[0]).toBe(await realpath(path.join(nested, 'App.tsx')));
    expect(confined.files[1]).toBe(path.join(await realpath(nested), 'src', 'New.tsx'));
  });

  it('rejects a cwd or file that leaves the project root', async () => {
    const root = await tempDir();
    const outside = await tempDir();
    await mkdir(root, { recursive: true });

    await expect(confineWorkspace(root, outside)).rejects.toBeInstanceOf(PathEscapeError);
    await expect(confineToRoot(root, '../secret', root)).rejects.toThrow(/escapes the project root/);
    await expect(confineToRoot(root, outside)).rejects.toThrow(/escapes the project root/);
  });

  it('rejects a symlink whose target is outside the project root', async () => {
    const root = await tempDir();
    const outside = await tempDir();
    await writeFile(path.join(outside, 'secret.txt'), 'nope\n');
    await symlink(outside, path.join(root, 'link'));

    await expect(confineWorkspace(root, path.join(root, 'link'))).rejects.toThrow(/escapes the project root/);
    await expect(confineToRoot(root, 'link/secret.txt')).rejects.toThrow(/escapes the project root/);
  });

  it('rejects a cwd that is missing or not a directory', async () => {
    const root = await tempDir();
    await writeFile(path.join(root, 'file.txt'), 'text\n');

    await expect(confineWorkspace(root, path.join(root, 'missing'))).rejects.toThrow(/cwd does not exist/);
    await expect(confineWorkspace(root, path.join(root, 'file.txt'))).rejects.toThrow(/not a directory/);
  });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'gateway-paths-'));
  roots.push(dir);
  return dir;
}
