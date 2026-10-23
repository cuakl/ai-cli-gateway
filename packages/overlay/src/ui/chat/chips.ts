import type { FailedNetworkRequest, FrontendError, SelectedElement } from '@aidev/protocol';
import type { ConsoleEntry } from '../../context/entries.js';
import { selectionChipLabel } from '../../inspector/locator.js';
import type { AutoAttachPrefs } from '../prefs.js';
import { CONTEXT_MAX_AGE_MS } from '../../context/index.js';
import { countLabel, type ContextChip, type ContextChipKind } from './model.js';

const PREVIEW_LIMIT = 280;

export interface DeriveChipsInput {
  selected?: SelectedElement | null;
  selections?: readonly SelectedElement[];
  screenshotUrl: string | null;
  screenshotError?: string | null;
  errors: readonly FrontendError[];
  failedRequests: readonly FailedNetworkRequest[];
  autoAttach: AutoAttachPrefs;
  excluded: ReadonlySet<ContextChipKind>;
  viteError?: string | null;
  testFailure?: string | null;
  breadcrumbs?: readonly (readonly string[])[];
  now?: number;
}

export function deriveContextChips(input: DeriveChipsInput): ContextChip[] {
  const now = input.now ?? Date.now();
  const chips: ContextChip[] = [];
  const selections =
    input.selections && input.selections.length > 0
      ? input.selections
      : input.selected
        ? [input.selected]
        : [];
  if (!input.excluded.has('selection')) {
    selections.forEach((selected, index) => {
      chips.push(
        selectionChip(selected, index, selections.length > 1, input.breadcrumbs?.[index]),
      );
    });
  }
  if (input.screenshotError && !input.excluded.has('screenshot')) {
    chips.push({
      id: 'screenshot',
      kind: 'screenshot',
      label: 'Screenshot failed',
      preview: input.screenshotError,
      warning: true,
    });
  } else if (input.autoAttach.screenshot && input.screenshotUrl && !input.excluded.has('screenshot')) {
    chips.push({
      id: 'screenshot',
      kind: 'screenshot',
      label: 'Screenshot',
      preview: 'Attached screenshot',
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

export function selectionChip(
  selected: SelectedElement,
  index: number,
  numbered: boolean,
  breadcrumb?: readonly string[],
): ContextChip {
  const loc = selected.sourceLocation;
  return {
    id: `selection:${index}`,
    kind: 'selection',
    label: selectionChipLabel(selected),
    preview: previewText(selected.outerHTML || selectionChipLabel(selected)),
    ...(numbered ? { badge: index + 1 } : {}),
    breadcrumb: breadcrumb && breadcrumb.length > 0 ? [...breadcrumb] : breadcrumbFromSelected(selected),
    ...(loc?.fileName
      ? { file: loc.fileName, line: loc.lineNumber, column: loc.columnNumber }
      : {}),
  };
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

export function chipFromConsoleEntry(entry: ConsoleEntry): ContextChip {
  const kind: ContextChipKind = entry.filter === 'vite' ? 'vite' : entry.filter === 'network' ? 'network' : 'console';
  const label =
    kind === 'vite' ? 'Vite error' : kind === 'network' ? 'Failed request' : previewText(entry.message).slice(0, 48);
  return {
    id: `fix:${entry.id}`,
    kind,
    label,
    preview: previewText(entry.stack ?? entry.message),
  };
}

function breadcrumbFromSelected(selected: SelectedElement): string[] {
  const name = selected.sourceLocation?.componentName;
  const tag = selected.tagName.toLowerCase();
  return name && name !== tag ? [name, tag] : [tag];
}

function previewText(value: string): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= PREVIEW_LIMIT) return trimmed;
  return `${trimmed.slice(0, PREVIEW_LIMIT)}…`;
}

