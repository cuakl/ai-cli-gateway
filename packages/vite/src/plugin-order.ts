/** Plugins that turn JSX into function calls. `data-loc` has to land before them. */
const JSX_COMPILERS = new Set([
  'vite:react-babel',
  'vite:react-swc',
  'vite:react-oxc',
  'vite:esbuild',
]);

export interface NamedPlugin {
  name: string;
}

/**
 * Move the DevTools transform ahead of the first JSX compiler.
 * `@vitejs/plugin-react` is `enforce: 'pre'` and rewrites the file, so a plugin
 * listed after `react()` would otherwise stamp locations onto shifted lines.
 */
export function placeBeforeJsxCompilers<T extends NamedPlugin>(plugins: T[], pluginName = 'ai-devtools'): void {
  if (Object.isFrozen(plugins)) return;
  const index = plugins.findIndex((plugin) => plugin.name === pluginName);
  if (index < 0) return;
  const compilerIndex = plugins.findIndex((plugin) => JSX_COMPILERS.has(plugin.name));
  if (compilerIndex < 0 || index < compilerIndex) return;
  const [plugin] = plugins.splice(index, 1);
  if (!plugin) return;
  const nextCompiler = plugins.findIndex((item) => JSX_COMPILERS.has(item.name));
  plugins.splice(nextCompiler < 0 ? plugins.length : nextCompiler, 0, plugin);
}
