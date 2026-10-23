import { h, options, render } from 'preact';
import { afterEach, describe, expect, it } from 'vitest';
import { Markdown } from '../src/ui/chat/markdown.js';

options.debounceRendering = (callback) => {
  callback();
};

describe('Markdown', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders paragraphs, emphasis, inline code, lists, and safe links', () => {
    const host = mount(
      [
        'Hello **bold** and *em* and `code`.',
        '',
        '- one',
        '- two',
        '',
        '1. first',
        '2. second',
        '',
        'See [docs](https://example.com/a) and [mail](mailto:dev@example.com).',
      ].join('\n'),
    );

    expect(host.querySelectorAll('p')).toHaveLength(2);
    expect(host.querySelector('strong')?.textContent).toBe('bold');
    expect(host.querySelector('em')?.textContent).toBe('em');
    expect(host.querySelector('p code')?.textContent).toBe('code');
    expect([...host.querySelectorAll('ul li')].map((item) => item.textContent)).toEqual(['one', 'two']);
    expect([...host.querySelectorAll('ol li')].map((item) => item.textContent)).toEqual(['first', 'second']);

    const links = [...host.querySelectorAll('a')];
    expect(links).toHaveLength(2);
    expect(links[0]?.getAttribute('href')).toBe('https://example.com/a');
    expect(links[1]?.getAttribute('href')).toBe('mailto:dev@example.com');
    for (const link of links) {
      expect(link.getAttribute('rel')).toBe('noreferrer');
      expect(link.getAttribute('target')).toBe('_blank');
    }
  });

  it('renders a fenced code block with language and a copy button', () => {
    const host = mount('```ts\nconst n = 1;\n```');
    expect(host.querySelector('[data-language="ts"]')).not.toBeNull();
    expect(host.querySelector('code')?.textContent).toBe('const n = 1;');
    const copy = host.querySelector('[data-action="copy-code"]');
    expect(copy?.tagName).toBe('BUTTON');
    expect(copy?.textContent).toBe('Copy');
  });

  it('renders an unclosed fence as a code block', () => {
    const host = mount('intro\n```js\nconst x = 1;');
    expect(host.textContent).toContain('intro');
    expect(host.querySelector('[data-language="js"]')).not.toBeNull();
    expect(host.querySelector('code')?.textContent).toBe('const x = 1;');
    expect(host.querySelector('[data-action="copy-code"]')).not.toBeNull();
  });

  it('keeps XSS strings as inert text', () => {
    const host = mount(
      ['<img src=x onerror=alert(1)>', '', '[x](javascript:alert(1))'].join('\n'),
    );
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('a')).toBeNull();
    expect(host.innerHTML).not.toContain('<img');
    expect(host.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(host.textContent).toContain('javascript:alert(1)');
  });
});

function mount(text: string): HTMLDivElement {
  const host = document.createElement('div');
  document.body.append(host);
  render(h(Markdown, { text }), host);
  return host;
}
