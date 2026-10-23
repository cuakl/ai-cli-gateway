import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { HttpError } from '../src/errors.js';
import { MAX_IMAGE_BYTES, writeInferImages } from '../src/inference/images.js';
import { solidPng } from './helpers.js';

const dirs: string[] = [];

describe('inference images', () => {
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('writes data URLs into scratch/attachments and copies to home when keep=true', async () => {
    const home = await tempDir('img-home-');
    const scratch = path.join(home, 'scratch', 'run_keep');
    const png = solidPng(255, 0, 0);
    const written = await writeInferImages({
      home,
      scratch,
      runId: 'run_keep',
      keep: true,
      images: [{ dataUrl: `data:image/png;base64,${png.toString('base64')}` }],
    });
    expect(written.promptPaths).toHaveLength(1);
    expect(written.promptPaths[0]).toBe(path.join(scratch, 'attachments', '0.png'));
    expect(existsSync(written.promptPaths[0] ?? '')).toBe(true);
    expect(written.attachments[0]).toMatchObject({
      kind: 'image',
      mime: 'image/png',
      path: path.join(home, 'attachments', 'run_keep', '0.png'),
    });
    expect(existsSync(written.attachments[0]?.path ?? '')).toBe(true);
  });

  it('does not keep a home copy when keep is false, and accepts a path source', async () => {
    const home = await tempDir('img-ephemeral-');
    const scratch = path.join(home, 'scratch', 'run_eph');
    const source = path.join(home, 'source.jpg');
    await writeFile(source, jpegBytes());
    const written = await writeInferImages({
      home,
      scratch,
      runId: 'run_eph',
      keep: false,
      images: [{ path: source }],
    });
    expect(written.promptPaths[0]).toBe(path.join(scratch, 'attachments', '0.jpg'));
    expect(existsSync(written.promptPaths[0] ?? '')).toBe(true);
    expect(written.attachments[0]?.path).toBe(written.promptPaths[0]);
    expect(existsSync(path.join(home, 'attachments', 'run_eph'))).toBe(false);
  });

  it('rejects more than 5 images, unknown mime, and oversized payloads', async () => {
    const home = await tempDir('img-bad-');
    const scratch = path.join(home, 'scratch', 'run_bad');
    const png = solidPng(0, 255, 0);
    const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
    await expect(
      writeInferImages({
        home,
        scratch,
        runId: 'run_bad',
        keep: false,
        images: Array.from({ length: 6 }, () => ({ dataUrl })),
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'validation_error' });

    await expect(
      writeInferImages({
        home,
        scratch,
        runId: 'run_bad',
        keep: false,
        images: [{ dataUrl: 'data:image/svg+xml;base64,aaa' }],
      }),
    ).rejects.toBeInstanceOf(HttpError);

    const huge = Buffer.alloc(MAX_IMAGE_BYTES + 1);
    huge[0] = 0x89;
    huge[1] = 0x50;
    huge[2] = 0x4e;
    huge[3] = 0x47;
    huge[4] = 0x0d;
    huge[5] = 0x0a;
    huge[6] = 0x1a;
    huge[7] = 0x0a;
    await expect(
      writeInferImages({
        home,
        scratch,
        runId: 'run_bad',
        keep: false,
        images: [{ dataUrl: `data:image/png;base64,${huge.toString('base64')}` }],
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** Minimal JPEG SOI + APP0 + EOI so sniffMime accepts it. */
function jpegBytes(): Buffer {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
    0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
  ]);
}
