export function languageFromPath(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? path;
  const ext = base.includes('.') ? (base.split('.').pop() ?? '').toLowerCase() : '';
  if (ext === 'tsx' || ext === 'jsx' || ext === 'ts' || ext === 'js') return ext;
  if (ext === 'mts' || ext === 'cts') return 'ts';
  if (ext === 'mjs' || ext === 'cjs') return 'js';
  if (ext === 'css') return 'css';
  if (ext === 'json') return 'json';
  if (ext === 'html' || ext === 'htm' || ext === 'svg') return 'html';
  if (ext === 'md' || ext === 'mdx') return 'md';
  return '';
}
