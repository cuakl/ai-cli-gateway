export type TokenKind = 'text' | 'keyword' | 'string' | 'comment' | 'number' | 'tag';

export interface Token {
  kind: TokenKind;
  text: string;
}

const JS_KEYWORDS = new Set([
  'abstract',
  'as',
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'declare',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'from',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'infer',
  'instanceof',
  'interface',
  'keyof',
  'let',
  'new',
  'null',
  'of',
  'override',
  'private',
  'protected',
  'public',
  'readonly',
  'return',
  'satisfies',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'type',
  'typeof',
  'undefined',
  'unique',
  'var',
  'void',
  'while',
  'with',
  'yield',
]);

const CSS_KEYWORDS = new Set(['and', 'from', 'important', 'not', 'only', 'or', 'to']);

const JSON_KEYWORDS = new Set(['true', 'false', 'null']);

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

export function tokenize(source: string, language: string): Token[] {
  if (!source) return [];
  if (language === 'css') return tokenizeCss(source);
  if (language === 'json') return tokenizeJson(source);
  if (language === 'html') return tokenizeHtml(source);
  if (language === 'md') return tokenizeMd(source);
  if (language === 'ts' || language === 'tsx' || language === 'js' || language === 'jsx') {
    return tokenizeJs(source, language === 'tsx' || language === 'jsx');
  }
  return [{ kind: 'text', text: source }];
}

function tokenizeJs(source: string, jsx: boolean): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const start = index;
    const ch = source[index] ?? '';
    if (ch === '/' && source[index + 1] === '/') {
      index = source.indexOf('\n', index);
      if (index < 0) index = source.length;
      push(tokens, 'comment', source.slice(start, index));
      continue;
    }
    if (ch === '/' && source[index + 1] === '*') {
      index = source.indexOf('*/', index + 2);
      index = index < 0 ? source.length : index + 2;
      push(tokens, 'comment', source.slice(start, index));
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      index = closeQuoted(source, index, ch);
      push(tokens, 'string', source.slice(start, index));
      continue;
    }
    if (jsx && isJsxTagStart(source, index)) {
      if (source[index + 1] === '/') {
        push(tokens, 'text', '</');
        index += 2;
      } else {
        push(tokens, 'text', '<');
        index += 1;
      }
      const nameStart = index;
      while (index < source.length && isIdentChar(source[index] ?? '')) index += 1;
      if (index > nameStart) push(tokens, 'tag', source.slice(nameStart, index));
      continue;
    }
    if (isNumberStart(source, index)) {
      index = consumeNumber(source, index);
      push(tokens, 'number', source.slice(start, index));
      continue;
    }
    if (isIdentStart(ch)) {
      while (index < source.length && isIdentChar(source[index] ?? '')) index += 1;
      const word = source.slice(start, index);
      push(tokens, JS_KEYWORDS.has(word) ? 'keyword' : 'text', word);
      continue;
    }
    index += 1;
    push(tokens, 'text', ch);
  }
  return tokens;
}

function tokenizeCss(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const start = index;
    const ch = source[index] ?? '';
    if (ch === '/' && source[index + 1] === '*') {
      index = source.indexOf('*/', index + 2);
      index = index < 0 ? source.length : index + 2;
      push(tokens, 'comment', source.slice(start, index));
      continue;
    }
    if (ch === '"' || ch === "'") {
      index = closeQuoted(source, index, ch);
      push(tokens, 'string', source.slice(start, index));
      continue;
    }
    if (ch === '#') {
      index += 1;
      while (index < source.length && /[0-9a-fA-F]/.test(source[index] ?? '')) index += 1;
      push(tokens, 'number', source.slice(start, index));
      continue;
    }
    if (ch === '@' || isIdentStart(ch)) {
      if (ch === '@') index += 1;
      while (index < source.length && isIdentChar(source[index] ?? '')) index += 1;
      const word = source.slice(start, index);
      const name = word.startsWith('@') ? word.slice(1) : word;
      push(tokens, CSS_KEYWORDS.has(name) || word.startsWith('@') ? 'keyword' : 'text', word);
      continue;
    }
    if (isDigit(ch) || (ch === '.' && isDigit(source[index + 1] ?? ''))) {
      index = consumeNumber(source, index);
      while (index < source.length && isIdentStart(source[index] ?? '')) index += 1;
      push(tokens, 'number', source.slice(start, index));
      continue;
    }
    index += 1;
    push(tokens, 'text', ch);
  }
  return tokens;
}

function tokenizeJson(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const start = index;
    const ch = source[index] ?? '';
    if (ch === '"') {
      index = closeQuoted(source, index, '"');
      push(tokens, 'string', source.slice(start, index));
      continue;
    }
    if (isNumberStart(source, index)) {
      index = consumeNumber(source, index);
      push(tokens, 'number', source.slice(start, index));
      continue;
    }
    if (isIdentStart(ch)) {
      while (index < source.length && isIdentChar(source[index] ?? '')) index += 1;
      const word = source.slice(start, index);
      push(tokens, JSON_KEYWORDS.has(word) ? 'keyword' : 'text', word);
      continue;
    }
    index += 1;
    push(tokens, 'text', ch);
  }
  return tokens;
}

function tokenizeHtml(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const start = index;
    if (source.startsWith('<!--', index)) {
      index = source.indexOf('-->', index + 4);
      index = index < 0 ? source.length : index + 3;
      push(tokens, 'comment', source.slice(start, index));
      continue;
    }
    const ch = source[index] ?? '';
    if (ch === '<' && (isIdentStart(source[index + 1] ?? '') || source[index + 1] === '/' || source[index + 1] === '!')) {
      if (source[index + 1] === '/') {
        push(tokens, 'text', '</');
        index += 2;
      } else {
        push(tokens, 'text', '<');
        index += 1;
      }
      const nameStart = index;
      while (index < source.length && isIdentChar(source[index] ?? '')) index += 1;
      if (index > nameStart) push(tokens, 'tag', source.slice(nameStart, index));
      continue;
    }
    if (ch === '"' || ch === "'") {
      index = closeQuoted(source, index, ch);
      push(tokens, 'string', source.slice(start, index));
      continue;
    }
    index += 1;
    push(tokens, 'text', ch);
  }
  return tokens;
}

function tokenizeMd(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const start = index;
    const ch = source[index] ?? '';
    if (ch === '`') {
      const fence = source.startsWith('```', index) ? 3 : 1;
      index += fence;
      const close = source.indexOf('`'.repeat(fence), index);
      index = close < 0 ? source.length : close + fence;
      push(tokens, 'string', source.slice(start, index));
      continue;
    }
    if (ch === '#' && (index === 0 || source[index - 1] === '\n')) {
      while (index < source.length && source[index] === '#') index += 1;
      push(tokens, 'keyword', source.slice(start, index));
      continue;
    }
    if (ch === '[' || (ch === '!' && source[index + 1] === '[')) {
      const bracket = source.indexOf(']', index);
      const paren = bracket >= 0 ? source.indexOf(')', bracket) : -1;
      if (bracket >= 0 && source[bracket + 1] === '(' && paren > bracket) {
        push(tokens, 'tag', source.slice(start, paren + 1));
        index = paren + 1;
        continue;
      }
    }
    if (ch === '<' && isIdentStart(source[index + 1] ?? '')) {
      push(tokens, 'text', '<');
      index += 1;
      const nameStart = index;
      while (index < source.length && isIdentChar(source[index] ?? '')) index += 1;
      push(tokens, 'tag', source.slice(nameStart, index));
      continue;
    }
    index += 1;
    push(tokens, 'text', ch);
  }
  return tokens;
}

function push(tokens: Token[], kind: TokenKind, text: string): void {
  if (!text) return;
  const last = tokens[tokens.length - 1];
  if (last && last.kind === kind) {
    last.text += text;
    return;
  }
  tokens.push({ kind, text });
}

function closeQuoted(source: string, start: number, quote: string): number {
  let index = start + 1;
  while (index < source.length) {
    const ch = source[index] ?? '';
    if (ch === '\\') {
      index += 2;
      continue;
    }
    if (quote === '`' && ch === '$' && source[index + 1] === '{') {
      index += 2;
      let depth = 1;
      while (index < source.length && depth > 0) {
        if (source[index] === '{') depth += 1;
        else if (source[index] === '}') depth -= 1;
        index += 1;
      }
      continue;
    }
    index += 1;
    if (ch === quote) break;
  }
  return index;
}

function isJsxTagStart(source: string, index: number): boolean {
  if (source[index] !== '<') return false;
  const next = source[index + 1] ?? '';
  if (next === '/' && isIdentStart(source[index + 2] ?? '')) return true;
  return isIdentStart(next);
}

function isNumberStart(source: string, index: number): boolean {
  const ch = source[index] ?? '';
  if (isDigit(ch)) return true;
  if (ch === '.' && isDigit(source[index + 1] ?? '')) return true;
  return false;
}

function consumeNumber(source: string, start: number): number {
  let index = start;
  if (source[index] === '.') index += 1;
  while (index < source.length && isDigit(source[index] ?? '')) index += 1;
  if (source[index] === '.' && isDigit(source[index + 1] ?? '')) {
    index += 1;
    while (index < source.length && isDigit(source[index] ?? '')) index += 1;
  }
  const exp = source[index];
  if (exp === 'e' || exp === 'E') {
    let next = index + 1;
    if (source[next] === '+' || source[next] === '-') next += 1;
    if (isDigit(source[next] ?? '')) {
      index = next;
      while (index < source.length && isDigit(source[index] ?? '')) index += 1;
    }
  }
  return index;
}

function isIdentStart(ch: string): boolean {
  return /[A-Za-z_$]/.test(ch);
}

function isIdentChar(ch: string): boolean {
  return /[A-Za-z0-9_$-]/.test(ch);
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}
