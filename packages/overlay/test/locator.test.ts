import { SelectedElementSchema } from '@aidev/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { locateElement, parseDataLoc, readDataLoc, selectionChipLabel } from '../src/inspector/locator.js';

describe('data-loc', () => {
  it('parses filepath:line:column', () => {
    expect(parseDataLoc('src/components/Header.tsx:24:5')).toEqual({
      fileName: 'src/components/Header.tsx',
      lineNumber: 24,
      columnNumber: 5,
    });
    expect(parseDataLoc('not a location')).toBeNull();
  });

  it('reads the attribute from the element or an ancestor', () => {
    const button = document.createElement('button');
    button.setAttribute('data-loc', 'src/components/Header.tsx:24:5');
    const span = document.createElement('span');
    button.appendChild(span);
    expect(readDataLoc(span)?.fileName).toBe('src/components/Header.tsx');
  });
});

describe('locateElement', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds a schema-valid element from data-loc', () => {
    vi.spyOn(window, 'getComputedStyle').mockImplementation(
      () =>
        ({
          getPropertyValue(property: string) {
            const values: Record<string, string> = {
              display: 'flex',
              position: 'relative',
              width: '320px',
              height: '48px',
              margin: '0px',
              padding: '8px',
              color: 'rgb(0, 0, 0)',
              background: '',
              'background-color': 'rgb(255, 255, 255)',
              font: '16px sans-serif',
            };
            return values[property] ?? '';
          },
        }) as CSSStyleDeclaration,
    );

    const button = document.createElement('button');
    button.id = 'hero';
    button.className = 'btn primary';
    button.setAttribute('onclick', 'alert(1)');
    button.innerHTML = '<script>alert(1)</script>Click';
    button.setAttribute('data-loc', 'src/components/Header.tsx:24:5');
    button.setAttribute('title', 'x'.repeat(5_000));

    const selected = locateElement(button);
    expect(SelectedElementSchema.parse(selected)).toEqual(selected);
    expect(selected.tagName).toBe('BUTTON');
    expect(selected.id).toBe('hero');
    expect(selected.className).toBe('btn primary');
    expect(selected.outerHTML).not.toContain('<script');
    expect(selected.outerHTML).not.toContain('onclick');
    expect(selected.outerHTML.endsWith('<!-- truncated -->')).toBe(true);
    expect(selected.computedStyles).toMatchObject({
      display: 'flex',
      background: 'rgb(255, 255, 255)',
      font: '16px sans-serif',
    });
    expect(selected.sourceLocation).toEqual({
      componentName: 'Header',
      fileName: 'src/components/Header.tsx',
      lineNumber: 24,
      columnNumber: 5,
      props: {},
    });
    expect(selectionChipLabel(selected)).toBe('Header · Header.tsx:24');
  });

  it('prefers the fiber component name and data-loc callsite together', () => {
    const button = document.createElement('button');
    button.setAttribute('data-loc', 'src/components/Hero.tsx:42:5');
    Object.assign(button, {
      __reactFiber$demo: {
        type: 'button',
        return: {
          type: { displayName: 'HeroButton' },
          memoizedProps: { tone: 'primary' },
          _debugSource: {
            fileName: 'src/components/HeroButton.tsx',
            lineNumber: 10,
            columnNumber: 1,
          },
        },
      },
    });

    const selected = locateElement(button);
    expect(selected.sourceLocation).toMatchObject({
      componentName: 'HeroButton',
      fileName: 'src/components/Hero.tsx',
      lineNumber: 42,
      columnNumber: 5,
      props: { tone: 'primary' },
    });
    expect(selectionChipLabel(selected)).toBe('HeroButton · Hero.tsx:42');
  });
});
