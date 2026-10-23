import type { FrontendError } from '@aidev/protocol';
import { notifyContext } from './bus.js';
import { clearErrorsMatching, recordError } from './errors.js';

const OVERLAY_TAG = 'vite-error-overlay';
const FIX_BUTTON_ATTR = 'data-aid-fix';

export type ViteFixHandler = (error: FrontendError) => void;

let installed = false;
let observer: MutationObserver | null = null;
let current: FrontendError | null = null;
let attached: Element | null = null;
let fixHandler: ViteFixHandler | null = null;
let stopHot: (() => void) | null = null;

export function setViteFixHandler(handler: ViteFixHandler | null): void {
  fixHandler = handler;
}

export function getViteError(): FrontendError | null {
  return current;
}

export function installViteCapture(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  stopHot = subscribeHot();
  observer = new MutationObserver(() => syncOverlay());
  const root = document.body ?? document.documentElement;
  if (root) observer.observe(root, { childList: true, subtree: true });
  syncOverlay();
}

export function uninstallViteCapture(): void {
  if (!installed) return;
  observer?.disconnect();
  observer = null;
  stopHot?.();
  stopHot = null;
  detachButton(attached);
  attached = null;
  current = null;
  fixHandler = null;
  installed = false;
}

function syncOverlay(): void {
  const overlay = document.querySelector(OVERLAY_TAG);
  if (!overlay) {
    if (current || attached) {
      detachButton(attached);
      attached = null;
      current = null;
      clearErrorsMatching((error) => error.type === 'vite');
    }
    return;
  }
  if (attached === overlay && current) {
    injectFixButton(overlay);
    return;
  }
  attached = overlay;
  const error = readOverlayError(overlay);
  current = error;
  recordError(error);
  injectFixButton(overlay);
}

function readOverlayError(overlay: Element): FrontendError {
  const fromProperty = readErrProperty(overlay);
  const root = overlay.shadowRoot;
  const message =
    fromProperty?.message ?? textOf(root, '.message') ?? 'Vite error';
  const file = fromProperty?.file ?? textOf(root, '.file');
  const frame = textOf(root, '.frame');
  const stackText = fromProperty?.stack ?? textOf(root, '.stack');
  const stack = [file, frame, stackText].filter(Boolean).join('\n') || undefined;
  return {
    type: 'vite',
    message: file ? `${message} (${file})` : message,
    ...(stack ? { stack } : {}),
    timestamp: Date.now(),
  };
}

function readErrProperty(overlay: Element): { message?: string; stack?: string; file?: string } | null {
  const record = overlay as Element & {
    err?: { message?: string; stack?: string; frame?: string; loc?: { file?: string; line?: number; column?: number } };
  };
  const err = record.err;
  if (!err || typeof err !== 'object') return null;
  const file = typeof err.loc?.file === 'string' ? err.loc.file : undefined;
  const stack = [err.frame, err.stack].filter((part) => typeof part === 'string' && part.length > 0).join('\n');
  return {
    ...(typeof err.message === 'string' ? { message: err.message } : {}),
    ...(stack ? { stack } : {}),
    ...(file ? { file } : {}),
  };
}

function injectFixButton(overlay: Element): void {
  const root = overlay.shadowRoot;
  if (!root || root.querySelector(`[${FIX_BUTTON_ATTR}]`)) return;
  const button = overlay.ownerDocument.createElement('button');
  button.type = 'button';
  button.textContent = 'Fix with AI';
  button.setAttribute(FIX_BUTTON_ATTR, 'true');
  button.setAttribute('aria-label', 'Fix with AI');
  button.style.cssText = [
    'appearance:none',
    'margin:8px 16px 12px',
    'padding:6px 12px',
    'border:0',
    'border-radius:8px',
    'background:#7c6cff',
    'color:#fff',
    'font:600 13px/1.4 ui-sans-serif,system-ui,sans-serif',
    'cursor:pointer',
  ].join(';');
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const error = current ?? readOverlayError(overlay);
    fixHandler?.(error);
  });
  const message = root.querySelector('.message');
  if (message?.parentNode) message.parentNode.insertBefore(button, message.nextSibling);
  else root.appendChild(button);
}

function detachButton(overlay: Element | null): void {
  const button = overlay?.shadowRoot?.querySelector(`[${FIX_BUTTON_ATTR}]`);
  button?.remove();
}

function textOf(root: ShadowRoot | null, selector: string): string | undefined {
  const text = root?.querySelector(selector)?.textContent?.trim();
  return text ? text : undefined;
}

function subscribeHot(): () => void {
  const hot = (import.meta as ImportMeta & {
    hot?: {
      on?: (event: string, cb: (payload: unknown) => void) => void;
      off?: (event: string, cb: (payload: unknown) => void) => void;
    };
  }).hot;
  if (!hot?.on) return () => undefined;
  const onError = (payload: unknown): void => {
    const error = fromHotPayload(payload);
    if (!error) return;
    current = error;
    recordError(error);
    notifyContext();
  };
  const onBefore = (): void => {
    current = null;
    clearErrorsMatching((error) => error.type === 'vite');
  };
  hot.on('vite:error', onError);
  hot.on('vite:beforeUpdate', onBefore);
  return () => {
    hot.off?.('vite:error', onError);
    hot.off?.('vite:beforeUpdate', onBefore);
  };
}

function fromHotPayload(payload: unknown): FrontendError | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as {
    message?: unknown;
    stack?: unknown;
    loc?: { file?: unknown };
    err?: { message?: unknown; stack?: unknown; loc?: { file?: unknown } };
  };
  const inner = record.err && typeof record.err === 'object' ? record.err : record;
  const message = typeof inner.message === 'string' ? inner.message : null;
  if (!message) return null;
  const stack = typeof inner.stack === 'string' ? inner.stack : undefined;
  const loc = 'loc' in inner ? inner.loc : undefined;
  const file = loc && typeof loc === 'object' && typeof loc.file === 'string' ? loc.file : undefined;
  return {
    type: 'vite',
    message: file ? `${message} (${file})` : message,
    ...(stack ? { stack } : {}),
    timestamp: Date.now(),
  };
}
