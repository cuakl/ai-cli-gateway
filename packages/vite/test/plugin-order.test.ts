import { describe, expect, it } from 'vitest';
import { placeBeforeJsxCompilers } from '../src/plugin-order.js';

describe('placeBeforeJsxCompilers', () => {
  it('moves the devtools transform ahead of the React JSX compiler', () => {
    const plugins = [
      { name: 'alias' },
      { name: 'vite:react-babel' },
      { name: 'ai-devtools' },
      { name: 'vite:esbuild' },
    ];
    placeBeforeJsxCompilers(plugins);
    expect(plugins.map((plugin) => plugin.name)).toEqual([
      'alias',
      'ai-devtools',
      'vite:react-babel',
      'vite:esbuild',
    ]);
  });

  it('leaves the plugin in place when it already runs first', () => {
    const plugins = [{ name: 'ai-devtools' }, { name: 'vite:esbuild' }];
    placeBeforeJsxCompilers(plugins);
    expect(plugins.map((plugin) => plugin.name)).toEqual(['ai-devtools', 'vite:esbuild']);
  });
});
