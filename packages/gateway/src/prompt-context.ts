import type { FrontendContextPayload, SelectedElement } from '@aidev/protocol';

/**
 * One composer for the `<frontend_context>` block.
 * Workspace runs call this on the server. The overlay still composes for the
 * legacy `/ws` prompt until it switches to `run.start`.
 */
export function composePrompt(prompt: string, context?: FrontendContextPayload): string {
  if (!context) return prompt;
  const elements = selectedElementList(context);
  const summary = {
    selectedElements: elements.map((element, index) => ({ index: index + 1, ...element })),
    selectedElement: elements[0] ?? context.selectedElement,
    recentErrors: context.recentErrors.slice(-10),
    recentConsoleLogs: context.recentConsoleLogs.slice(-10),
    failedNetworkRequests: context.failedNetworkRequests.slice(-10),
    screenshotIncluded: Boolean(context.screenshotBase64),
  };
  return `${prompt}\n\n<frontend_context>\n${JSON.stringify(summary, null, 2)}\n</frontend_context>`;
}

function selectedElementList(context: FrontendContextPayload): SelectedElement[] {
  if (context.selectedElements && context.selectedElements.length > 0) {
    return context.selectedElements.slice(0, 5);
  }
  return context.selectedElement ? [context.selectedElement] : [];
}
