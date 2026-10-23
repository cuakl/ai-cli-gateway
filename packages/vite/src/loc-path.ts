import path from 'node:path';

export function isIgnoredId(id: string): boolean {
  return id.includes('\0') || id.startsWith('virtual:') || id.includes('/virtual:');
}

export function filePathFromId(id: string): string {
  const withoutQuery = id.split('?')[0] ?? id;
  return withoutQuery.split('#')[0] ?? withoutQuery;
}

export function isNodeModules(filePath: string): boolean {
  return filePath.split(/[/\\]/).includes('node_modules');
}

export function toProjectPath(filePath: string, rootDir: string): string {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(rootDir, filePath);
  const relative = path.relative(rootDir, absolute);
  const normalized = relative.split(path.sep).join('/');
  return normalized === '' ? path.basename(filePath) : normalized;
}

export function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export function shouldStampFile(id: string): boolean {
  if (isIgnoredId(id)) return false;
  return !isNodeModules(filePathFromId(id));
}
