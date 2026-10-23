import { afterEach, describe, expect, it } from 'vitest';
import {
  appendSelection,
  breadcrumbLabels,
  locAncestors,
  MAX_SELECTIONS,
  pickHoverTarget,
  walkDown,
  walkUp,
} from '../src/inspector/walk.js';

function loc(file: string, line: number): string {
  return `${file}:${line}:1`;
}

describe('loc walk', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('skips node_modules paths and picks the deepest user-code data-loc', () => {
    const outer = document.createElement('div');
    outer.setAttribute('data-loc', loc('src/components/CardGrid.tsx', 10));
    const lib = document.createElement('span');
    lib.setAttribute('data-loc', loc('node_modules/ui/Button.tsx', 4));
    const price = document.createElement('strong');
    price.setAttribute('data-loc', loc('src/components/CardGrid.tsx', 30));
    outer.appendChild(lib);
    lib.appendChild(price);
    document.body.appendChild(outer);

    expect(pickHoverTarget(price)).toBe(price);
    expect(locAncestors(price).map((node) => node.tagName.toLowerCase())).toEqual(['strong', 'div']);
    expect(walkUp(locAncestors(price).slice().reverse(), 1)).toBe(0);
    expect(walkDown(locAncestors(price).slice().reverse(), 0)).toBe(1);
  });

  it('builds a breadcrumb that ends with the leaf tag', () => {
    const grid = document.createElement('section');
    grid.setAttribute('data-loc', loc('src/components/CardGrid.tsx', 10));
    Object.assign(grid, {
      __reactFiber$demo: {
        type: { displayName: 'CardGrid' },
        _debugSource: { fileName: 'src/components/CardGrid.tsx', lineNumber: 10, columnNumber: 1 },
      },
    });
    const card = document.createElement('button');
    card.setAttribute('data-loc', loc('src/components/CardGrid.tsx', 21));
    const price = document.createElement('strong');
    price.setAttribute('data-loc', loc('src/components/CardGrid.tsx', 30));
    grid.appendChild(card);
    card.appendChild(price);
    document.body.appendChild(grid);

    const crumb = breadcrumbLabels(price);
    expect(crumb[0]).toBe('CardGrid');
    expect(crumb[crumb.length - 1]).toBe('strong');
  });

  it('retargets to an ancestor from the breadcrumb index', () => {
    const card = document.createElement('button');
    card.setAttribute('data-loc', loc('src/CardGrid.tsx', 21));
    const price = document.createElement('strong');
    price.setAttribute('data-loc', loc('src/CardGrid.tsx', 30));
    card.appendChild(price);
    document.body.appendChild(card);
    const ancestors = locAncestors(price).slice().reverse();
    expect(ancestors[0]).toBe(card);
    expect(ancestors[1]).toBe(price);
  });

  it('caps shift multi-select at 5 unique elements', () => {
    const nodes = Array.from({ length: 6 }, () => document.createElement('div'));
    let selected: Element[] = [];
    for (const node of nodes) selected = appendSelection(selected, node);
    expect(selected).toHaveLength(MAX_SELECTIONS);
    expect(appendSelection(selected, nodes[0]!)).toHaveLength(MAX_SELECTIONS);
  });
});
