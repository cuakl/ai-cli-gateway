import { injectDataLoc } from '@aidev/vite';

export interface AidevLoaderOptions {
  root?: string;
}

export interface AidevLoaderContext {
  resourcePath: string;
  sourceMap?: boolean;
  cacheable?: (flag?: boolean) => void;
  getOptions?: () => AidevLoaderOptions;
  callback: (error: Error | null, code?: string, map?: unknown) => void;
}

/**
 * Webpack/Turbopack loader: stamp `data-loc` onto user JSX/TSX.
 * `node_modules` is a no-op because `injectDataLoc` already skips it.
 */
export default function aidevLoader(this: AidevLoaderContext, source: string): string | undefined {
  this.cacheable?.(true);
  const options = typeof this.getOptions === 'function' ? this.getOptions() : {};
  const root = options.root ?? process.cwd();
  const result = injectDataLoc(source, this.resourcePath, root);
  if (!result) return source;
  this.callback(null, result.code, result.map);
  return undefined;
}
