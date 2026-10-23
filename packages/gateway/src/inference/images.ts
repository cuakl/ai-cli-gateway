import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ImageAttachment, InferImage } from '@aidev/protocol';
import { HttpError } from '../errors.js';

export const MAX_INFER_IMAGES = 5;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const ALLOWED = new Set(Object.keys(MIME_EXT));

export interface WrittenImages {
  attachments: ImageAttachment[];
  /** Absolute paths under the scratch workspace so ask-mode CLIs can Read them. */
  promptPaths: string[];
}

export function imagePromptNote(paths: readonly string[]): string {
  if (paths.length === 0) return '';
  return `Attached images (read them before answering): ${paths.join(' ')}`;
}

/**
 * Decode and validate images, write them into `scratch/attachments/`, and when
 * `keep` is set also copy them to `$AIDEV_HOME/attachments/<runId>/`.
 */
export async function writeInferImages(options: {
  home: string;
  scratch: string;
  runId: string;
  images: readonly InferImage[];
  keep: boolean;
}): Promise<WrittenImages> {
  if (options.images.length === 0) return { attachments: [], promptPaths: [] };
  if (options.images.length > MAX_INFER_IMAGES) {
    throw new HttpError(
      400,
      'validation_error',
      `images: at most ${MAX_INFER_IMAGES} images are allowed`,
    );
  }

  const scratchDir = path.join(options.scratch, 'attachments');
  await mkdir(scratchDir, { recursive: true, mode: 0o700 });
  const homeDir = path.join(options.home, 'attachments', options.runId);
  if (options.keep) await mkdir(homeDir, { recursive: true, mode: 0o700 });

  const attachments: ImageAttachment[] = [];
  const promptPaths: string[] = [];
  for (let index = 0; index < options.images.length; index += 1) {
    const image = options.images[index];
    if (!image) continue;
    const decoded = await decodeImage(image, index);
    const ext = MIME_EXT[decoded.mime] ?? 'png';
    const name = `${index}.${ext}`;
    const scratchPath = path.join(scratchDir, name);
    await writeFile(scratchPath, decoded.bytes, { mode: 0o600 });
    let recorded = scratchPath;
    if (options.keep) {
      recorded = path.join(homeDir, name);
      await writeFile(recorded, decoded.bytes, { mode: 0o600 });
    }
    attachments.push({ kind: 'image', path: recorded, mime: decoded.mime });
    promptPaths.push(scratchPath);
  }
  return { attachments, promptPaths };
}

/**
 * Write overlay screenshots to `$AIDEV_HOME/attachments/<runId>/` and return
 * those paths for the CLI prompt.
 */
export async function writeRunAttachments(options: {
  home: string;
  runId: string;
  images: ReadonlyArray<{ dataUrl: string }>;
}): Promise<WrittenImages> {
  if (options.images.length === 0) return { attachments: [], promptPaths: [] };
  if (options.images.length > MAX_INFER_IMAGES) {
    throw new HttpError(
      400,
      'validation_error',
      `attachments: at most ${MAX_INFER_IMAGES} images are allowed`,
    );
  }
  const dir = path.join(options.home, 'attachments', options.runId);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const attachments: ImageAttachment[] = [];
  const promptPaths: string[] = [];
  for (let index = 0; index < options.images.length; index += 1) {
    const image = options.images[index];
    if (!image) continue;
    const decoded = decodeDataUrl(image.dataUrl, index);
    const ext = MIME_EXT[decoded.mime] ?? 'png';
    const name = `${index}.${ext}`;
    const recorded = path.join(dir, name);
    await writeFile(recorded, decoded.bytes, { mode: 0o600 });
    attachments.push({ kind: 'image', path: recorded, mime: decoded.mime });
    promptPaths.push(recorded);
  }
  return { attachments, promptPaths };
}

async function decodeImage(
  image: InferImage,
  index: number,
): Promise<{ bytes: Buffer; mime: string }> {
  if ('dataUrl' in image) return decodeDataUrl(image.dataUrl, index);
  return decodePath(image.path, index);
}

function decodeDataUrl(dataUrl: string, index: number): { bytes: Buffer; mime: string } {
  const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/i.exec(dataUrl.trim());
  if (!match) {
    throw new HttpError(400, 'validation_error', `images.${index}: expected a data: URL`);
  }
  const declared = (match[1] ?? '').trim().toLowerCase();
  const isBase64 = Boolean(match[2]);
  if (!isBase64) {
    throw new HttpError(400, 'validation_error', `images.${index}: data URL must be base64`);
  }
  if (declared && !ALLOWED.has(declared)) {
    throw new HttpError(
      400,
      'validation_error',
      `images.${index}: mime must be image/png, image/jpeg, image/webp, or image/gif`,
    );
  }
  let bytes: Buffer;
  try {
    bytes = Buffer.from(match[3] ?? '', 'base64');
  } catch {
    throw new HttpError(400, 'validation_error', `images.${index}: invalid base64`);
  }
  return inspectBytes(bytes, index, declared || undefined);
}

async function decodePath(filePath: string, index: number): Promise<{ bytes: Buffer; mime: string }> {
  let bytes: Buffer;
  try {
    bytes = await readFile(filePath);
  } catch {
    throw new HttpError(400, 'validation_error', `images.${index}: could not read path`);
  }
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const fromExt =
    ext === 'jpg' || ext === 'jpeg'
      ? 'image/jpeg'
      : ext === 'png'
        ? 'image/png'
        : ext === 'webp'
          ? 'image/webp'
          : ext === 'gif'
            ? 'image/gif'
            : undefined;
  return inspectBytes(bytes, index, fromExt);
}

function inspectBytes(
  bytes: Buffer,
  index: number,
  declared: string | undefined,
): { bytes: Buffer; mime: string } {
  if (bytes.length === 0) {
    throw new HttpError(400, 'validation_error', `images.${index}: image is empty`);
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new HttpError(
      400,
      'validation_error',
      `images.${index}: each image must be at most ${MAX_IMAGE_BYTES} bytes`,
    );
  }
  const sniffed = sniffMime(bytes);
  if (!sniffed) {
    throw new HttpError(
      400,
      'validation_error',
      `images.${index}: mime must be image/png, image/jpeg, image/webp, or image/gif`,
    );
  }
  if (declared && normalizeMime(declared) !== sniffed) {
    throw new HttpError(
      400,
      'validation_error',
      `images.${index}: declared mime ${declared} does not match file bytes`,
    );
  }
  return { bytes, mime: sniffed };
}

function normalizeMime(mime: string): string {
  return mime === 'image/jpg' ? 'image/jpeg' : mime;
}

function sniffMime(bytes: Buffer): string | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return 'image/gif';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return undefined;
}
