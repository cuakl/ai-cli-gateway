#!/usr/bin/env node
import { gzipSync } from 'node:zlib';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LIMIT = 60_000;
const dist = fileURLToPath(new URL('../dist', import.meta.url));

async function gzipSize(file) {
  const body = await readFile(file);
  return { raw: body.byteLength, gzip: gzipSync(body).length };
}

function classify(fileName) {
  const name = fileName.toLowerCase();
  if (name === 'overlay.js') return 'loader';
  if (name === 'app.js') return 'app';
  if (name.includes('xterm')) return 'xterm';
  if (name.includes('html-to-image') || name.includes('htmltoimage')) return 'html-to-image';
  if (name.includes('highlighter') || name.includes('highlight') || name.includes('tokens')) {
    return 'highlighter';
  }
  return null;
}

async function walkJs(dir, prefix = '') {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkJs(full, relative)));
      continue;
    }
    if (entry.name.endsWith('.js') && !entry.name.endsWith('.map')) files.push({ relative, full });
  }
  return files;
}

const files = await walkJs(dist).catch(() => []);
if (files.length === 0) {
  console.error(`overlay dist is missing at ${dist}. Run pnpm --filter @aidev/overlay build.`);
  process.exit(1);
}

const sizes = new Map();
for (const file of files) {
  const kind = classify(path.basename(file.relative));
  if (!kind) continue;
  const next = await gzipSize(file.full);
  const prev = sizes.get(kind);
  if (!prev) sizes.set(kind, { ...next, files: [file.relative] });
  else {
    prev.raw += next.raw;
    prev.gzip += next.gzip;
    prev.files.push(file.relative);
  }
}

const order = ['loader', 'app', 'xterm', 'html-to-image', 'highlighter'];
for (const kind of order) {
  const row = sizes.get(kind);
  if (!row) {
    console.log(`${kind}: (not found)`);
    continue;
  }
  console.log(`${kind}: ${row.gzip} B gzip / ${row.raw} B raw (${row.files.join(', ')})`);
}

const loader = sizes.get('loader');
if (!loader) {
  console.error('overlay loader dist/overlay.js was not found.');
  process.exit(1);
}
if (loader.gzip > LIMIT) {
  console.error(`overlay loader is ${loader.gzip} bytes gzip (limit ${LIMIT}).`);
  process.exit(1);
}
console.log(`ok: loader ${loader.gzip} B gzip <= ${LIMIT}`);
