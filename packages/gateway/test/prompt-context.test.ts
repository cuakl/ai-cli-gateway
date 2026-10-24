import { describe, expect, it } from 'vitest';
import type { SelectedElement } from '@aidev/protocol';
import { composePrompt } from '../src/prompt-context.js';

function element(id: string): SelectedElement {
  return {
    tagName: 'STRONG',
    id,
    className: '',
    outerHTML: `<strong id="${id}">$${id}</strong>`,
    computedStyles: {},
    sourceLocation: {
      componentName: 'CardGrid',
      fileName: 'CardGrid.tsx',
      lineNumber: 30,
      columnNumber: 12,
      props: {},
    },
  };
}

describe('composePrompt', () => {
  it('numbers every selected element 1..N to match on-page badges', () => {
    const composed = composePrompt('Restyle these cards', {
      selectedElement: element('86'),
      selectedElements: [element('86'), element('42')],
      recentErrors: [],
      recentConsoleLogs: [],
      failedNetworkRequests: [],
    });
    expect(composed.startsWith('Restyle these cards\n\n<frontend_context>\n')).toBe(true);
    expect(composed.endsWith('\n</frontend_context>')).toBe(true);
    const json = composed.slice(composed.indexOf('{'), composed.lastIndexOf('}') + 1);
    const parsed = JSON.parse(json) as {
      selectedElement: { id: string };
      selectedElements: Array<{ index: number; id: string }>;
    };
    expect(parsed.selectedElements).toEqual([
      expect.objectContaining({ index: 1, id: '86', tagName: 'STRONG' }),
      expect.objectContaining({ index: 2, id: '42', tagName: 'STRONG' }),
    ]);
    expect(parsed.selectedElement.id).toBe('86');
  });

  it('falls back to selectedElement when selectedElements is omitted', () => {
    const composed = composePrompt('Fix this', {
      selectedElement: element('hero'),
      recentErrors: [],
      recentConsoleLogs: [],
      failedNetworkRequests: [],
    });
    const json = composed.slice(composed.indexOf('{'), composed.lastIndexOf('}') + 1);
    const parsed = JSON.parse(json) as {
      selectedElement: { id: string };
      selectedElements: Array<{ index: number; id: string }>;
    };
    expect(parsed.selectedElements).toEqual([expect.objectContaining({ index: 1, id: 'hero' })]);
    expect(parsed.selectedElement.id).toBe('hero');
  });
});
