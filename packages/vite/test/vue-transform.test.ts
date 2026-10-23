import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileTemplate, parse } from '@vue/compiler-sfc';
import { describe, expect, it } from 'vitest';
import { aiDevtools } from '../src/index.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/widget.vue', import.meta.url));

describe('aiDevtools({ framework: "vue" })', () => {
  it('stamps native elements and skips components', async () => {
    const source = await readFile(fixture, 'utf8');
    const filename = path.join(root, 'test/fixtures/widget.vue');
    const { descriptor } = parse(source, { filename });
    const template = descriptor.template?.content;
    expect(template).toBeTruthy();
    const transform = aiDevtools({ framework: 'vue', root });
    const { code, errors } = compileTemplate({
      source: template ?? '',
      filename,
      id: 'widget',
      compilerOptions: {
        nodeTransforms: [transform],
      },
    });
    expect(errors).toEqual([]);
    expect(code).toContain('"button"');
    expect(code).toMatch(/data-loc":\s*"test\/fixtures\/widget\.vue:\d+:\d+"/);
    expect(code.match(/data-loc/g)?.length).toBe(2);
    expect(code).not.toMatch(/HeroButton[\s\S]{0,120}data-loc/);
  });
});
