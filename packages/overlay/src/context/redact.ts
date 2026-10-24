import type { FrontendContextPayload, FrontendError, SelectedElement } from '@aidev/protocol';

export const SENSITIVE_QUERY_KEY = /token|key|secret|password|auth|session/i;
export const CONTEXT_JSON_LIMIT = 32 * 1024;
const REDACTED = 'REDACTED';

const SENSITIVE_INPUT_TYPE = /^(password|email|tel)$/i;

export function redactUrl(url: string, base = defaultBase()): string {
  try {
    const parsed = new URL(url, base);
    let changed = false;
    for (const key of [...parsed.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEY.test(key)) {
        parsed.searchParams.set(key, REDACTED);
        changed = true;
      }
    }
    if (!changed) return url;
    if (isRelativeUrl(url)) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    return parsed.toString();
  } catch {
    return url.replace(/([?&][^=]*?(?:token|key|secret|password|auth|session)[^=]*?=)[^&]*/gi, `$1${REDACTED}`);
  }
}

export function redactText(value: string): string {
  return value.replace(/https?:\/\/[^\s"'<>]+/g, (match) => redactUrl(match)).replace(
    /(?:\?|&)[^=]*?(?:token|key|secret|password|auth|session)[^=]*=[^&\s"'<>]*/gi,
    (match) => match.replace(/=[^&\s"'<>]*/, `=${REDACTED}`),
  );
}

export function redactHtml(html: string): string {
  if (typeof document === 'undefined') return redactText(html);
  try {
    const template = document.createElement('template');
    template.innerHTML = html;
    redactSensitiveInputs(template.content);
    return template.innerHTML;
  } catch {
    return redactText(html);
  }
}

export function redactSensitiveInputs(root: ParentNode): void {
  const nodes = root.querySelectorAll('input, textarea');
  for (const node of nodes) {
    if (!shouldRedactField(node)) continue;
    node.setAttribute('value', '');
    node.removeAttribute('value');
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
      node.value = '';
    }
  }
}

export function shouldRedactField(node: Element): boolean {
  const type = (node.getAttribute('type') ?? (node instanceof HTMLInputElement ? node.type : '')).toLowerCase();
  if (SENSITIVE_INPUT_TYPE.test(type)) return true;
  const autocomplete =
    node.getAttribute('autocomplete') ??
    (node instanceof HTMLInputElement ? node.autocomplete : '') ??
    '';
  return autocomplete.toLowerCase().includes('cc-');
}

export function redactContext(payload: FrontendContextPayload): FrontendContextPayload {
  const redacted: FrontendContextPayload = {
    ...payload,
    ...(payload.selectedElement ? { selectedElement: redactSelected(payload.selectedElement) } : {}),
    ...(payload.selectedElements && payload.selectedElements.length > 0
      ? { selectedElements: payload.selectedElements.map(redactSelected) }
      : {}),
    recentErrors: payload.recentErrors.map(redactError),
    recentConsoleLogs: payload.recentConsoleLogs.map((entry) => ({
      ...entry,
      args: entry.args.map(redactText),
    })),
    failedNetworkRequests: payload.failedNetworkRequests.map((entry) => ({
      ...entry,
      url: redactUrl(entry.url),
      ...(entry.bodyPreview ? { bodyPreview: redactText(entry.bodyPreview) } : {}),
    })),
  };
  return capContextJson(redacted);
}

function redactSelected(selected: SelectedElement): SelectedElement {
  return {
    ...selected,
    outerHTML: redactHtml(selected.outerHTML),
  };
}

function redactError(error: FrontendError): FrontendError {
  return {
    ...error,
    message: redactText(error.message),
    ...(error.stack ? { stack: redactText(error.stack) } : {}),
  };
}

function capContextJson(payload: FrontendContextPayload): FrontendContextPayload {
  if (jsonSize(payload) <= CONTEXT_JSON_LIMIT) return payload;
  const next: FrontendContextPayload = {
    ...payload,
    recentConsoleLogs: payload.recentConsoleLogs.slice(),
    recentErrors: payload.recentErrors.slice(),
    failedNetworkRequests: payload.failedNetworkRequests.slice(),
  };
  while (next.recentConsoleLogs.length > 0 && jsonSize(next) > CONTEXT_JSON_LIMIT) {
    next.recentConsoleLogs.shift();
  }
  while (next.recentErrors.length > 0 && jsonSize(next) > CONTEXT_JSON_LIMIT) {
    next.recentErrors.shift();
  }
  while (next.failedNetworkRequests.length > 0 && jsonSize(next) > CONTEXT_JSON_LIMIT) {
    next.failedNetworkRequests.shift();
  }
  if (jsonSize(next) > CONTEXT_JSON_LIMIT && next.screenshotBase64) {
    const { screenshotBase64: _dropped, ...rest } = next;
    return rest;
  }
  return next;
}

function jsonSize(value: unknown): number {
  return JSON.stringify(value).length;
}

function defaultBase(): string {
  if (typeof window !== 'undefined' && window.location?.href) return window.location.href;
  return 'http://localhost/';
}

function isRelativeUrl(url: string): boolean {
  return url.startsWith('/') || url.startsWith('?') || url.startsWith('./') || url.startsWith('../');
}
