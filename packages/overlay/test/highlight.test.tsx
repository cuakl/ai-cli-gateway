import { h, options, render } from 'preact';
import { afterEach, describe, expect, it } from 'vitest';
import { Highlight } from '../src/ui/diff/Highlight.js';
import { tokenize } from '../src/ui/diff/tokens.js';

options.debounceRendering = (callback) => {
  callback();
};

const SAMPLE = `const label = "hello";
export function Hero() {
  return <button className="primary">Hi</button>;
}`;

describe('diff highlighter', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('tokenizes a TSX sample with string, keyword, and tag classes', () => {
    const tokens = tokenize(SAMPLE, 'tsx');
    const kinds = new Set(tokens.map((token) => token.kind));
    expect(kinds.has('keyword')).toBe(true);
    expect(kinds.has('string')).toBe(true);
    expect(kinds.has('tag')).toBe(true);
    expect(tokens.some((token) => token.kind === 'keyword' && token.text === 'const')).toBe(true);
    expect(tokens.some((token) => token.kind === 'keyword' && token.text === 'export')).toBe(true);
    expect(tokens.some((token) => token.kind === 'string' && token.text.includes('hello'))).toBe(true);
    expect(tokens.some((token) => token.kind === 'tag' && token.text === 'button')).toBe(true);
  });

  it('renders tokens as text nodes and escapes HTML', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    render(h(Highlight, { text: 'const x = "<img onerror=\'alert(1)\'>";', language: 'ts' }), host);
    expect(host.querySelector('img')).toBeNull();
    expect(host.innerHTML.toLowerCase()).not.toContain('<img');
    expect(host.textContent).toContain("<img onerror='alert(1)'>");
    expect(host.querySelector('.tok-string')?.textContent).toContain('<img');
    expect(host.querySelector('.tok-keyword')?.textContent).toBe('const');
  });
});
