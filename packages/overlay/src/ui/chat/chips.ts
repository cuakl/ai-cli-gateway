import type { FailedNetworkRequest, FrontendError, SelectedElement } from '@aidev/protocol';
import { selectionChipLabel } from '../../inspector/locator.js';
import type { AutoAttachPrefs } from '../prefs.js';
import { CONTEXT_MAX_AGE_MS } from '../../context/index.js';
import { countLabel, type ContextChip, type ContextChipKind } from './model.js';

const PREVIEW_LIMIT = 280;

export interface DeriveChipsInput {
  selected: SelectedElement | null;
  screenshotUrl: string | null;
  errors: readonly FrontendError[];
  failedRequests: readonly FailedNetworkRequest[];
  autoAttach: AutoAttachPrefs;
  excluded: ReadonlySet<ContextChipKind>;
  viteError?: string | null;
  testFailure?: string | null;
  now?: number;
}

export function deriveContextChips(input: DeriveChipsInput): ContextChip[] {
  const now = input.now ?? Date.now();
  const chips: ContextChip[] = [];
  if (input.selected && !input.excluded.has('selection')) {
    chips.push({
      id: 'selection',
      kind: 'selection',
      label: selectionChipLabel(input.selected),
      preview: previewText(input.selected.outerHTML || selectionChipLabel(input.selected)),
    });
  }
  if (input.autoAttach.screenshot && input.screenshotUrl && !input.excluded.has('screenshot')) {
    chips.push({
      id: 'screenshot',
      kind: 'screenshot',
      label: 'Screenshot',
      preview: 'Attached screenshot of the selected element',
      thumbnail: input.screenshotUrl,
    });
  }
  const recentErrors = input.errors.filter((entry) => now - entry.timestamp <= CONTEXT_MAX_AGE_MS);
  if (input.autoAttach.consoleErrors && recentErrors.length > 0 && !input.excluded.has('console')) {
    chips.push({
      id: 'console',
      kind: 'console',
      label: countLabel(recentErrors.length, 'console error', 'console errors'),
      preview: previewText(recentErrors.map((entry) => entry.message).join('\n')),
    });
  }
  if (
    input.autoAttach.failedRequests &&
    input.failedRequests.length > 0 &&
    !input.excluded.has('network')
  ) {
    chips.push({
      id: 'network',
      kind: 'network',
      label: countLabel(input.failedRequests.length, 'failed request', 'failed requests'),
      preview: previewText(input.failedRequests.map((entry) => `${entry.status} ${entry.url}`).join('\n')),
    });
  }
  if (input.viteError && !input.excluded.has('vite')) {
    chips.push({
      id: 'vite',
      kind: 'vite',
      label: 'Vite error',
      preview: previewText(input.viteError),
    });
  }
  if (input.testFailure && !input.excluded.has('test')) {
    chips.push({
      id: 'test',
      kind: 'test',
      label: 'Test failure',
      preview: previewText(input.testFailure),
    });
  }
  return chips;
}

export function composerSuggestions(input: {
  selected: SelectedElement | null;
  consoleErrorCount: number;
}): string[] {
  const suggestions: string[] = [];
  const selected = input.selected;
  if (selected) {
    const name = selected.sourceLocation?.componentName ?? selected.tagName.toLowerCase();
    suggestions.push(`Make \`${name}\` responsive`);
    if (selected.tagName.toLowerCase() === 'button') {
      suggestions.push('Add a hover state to this button');
    }
  }
  if (input.consoleErrorCount > 0) {
    suggestions.push(`Fix the ${countLabel(input.consoleErrorCount, 'console error', 'console errors')}`);
  }
  return suggestions;
}

function previewText(value: string): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= PREVIEW_LIMIT) return trimmed;
  return `${trimmed.slice(0, PREVIEW_LIMIT)}…`;
}
