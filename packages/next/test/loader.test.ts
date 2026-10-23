import path from 'node:path';
import { describe, expect, it } from 'vitest';
import aidevLoader, { type AidevLoaderContext } from '../src/loader.js';

const root = path.resolve('/proj');

describe('aidev loader', () => {
  it('stamps data-loc on a .tsx sample', () => {
    const source = [
      'export function View() {',
      '  return (',
      '    <div>',
      '      <button>Go</button>',
      '    </div>',
      '  );',
      '}',
    ].join('\n');
    const result = runLoader(source, path.join(root, 'src/App.tsx'));
    expect(result).toContain('data-loc="src/App.tsx:3:4"');
    expect(result).toContain('<button data-loc="src/App.tsx:4:6">');
  });

  it('skips node_modules', () => {
    const source = 'export const node = <div />;\n';
    expect(runLoader(source, path.join(root, 'node_modules/pkg/Button.tsx'))).toBe(source);
  });
});

function runLoader(source: string, resourcePath: string): string {
  let callbackCode: string | undefined;
  const ctx: AidevLoaderContext = {
    resourcePath,
    getOptions: () => ({ root }),
    cacheable() {},
    callback(_error, code) {
      callbackCode = code;
    },
  };
  const sync = aidevLoader.call(ctx, source);
  return callbackCode ?? sync ?? source;
}
