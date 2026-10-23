import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { aidevSveltePreprocess } from '../src/index.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/widget.svelte', import.meta.url));

describe('aidevSveltePreprocess', () => {
  it('stamps native elements and skips components', async () => {
    const source = await readFile(fixture, 'utf8');
    const filename = path.join(root, 'test/fixtures/widget.svelte');
    const result = await aidevSveltePreprocess({ root }).markup({ content: source, filename });
    expect(result?.code).toBeTruthy();
    const code = result?.code ?? '';
    expect(code).toContain('<section data-loc="test/fixtures/widget.svelte:1:1" class="wrap">');
    expect(code).toContain('<button data-loc="test/fixtures/widget.svelte:2:3" class="go">');
    expect(code).toContain('<HeroButton label="x" />');
    expect(code).not.toContain('<HeroButton data-loc');
    expect(code.match(/data-loc="/g)).toHaveLength(2);
  });
});
