/**
 * Classic-script loader for `<script src="/overlay.js" defer>`.
 * Resolves `./overlay/app.js` from the script URL so chunks stay on the same origin.
 * Must not mention `import.meta` — that is a SyntaxError in classic scripts.
 */

const capturedSrc =
  typeof document !== 'undefined' && document.currentScript instanceof HTMLScriptElement
    ? document.currentScript.src
    : '';

function overlayScriptUrl(): string {
  if (capturedSrc) return capturedSrc;
  if (typeof document === 'undefined') return '';
  const marked = document.querySelector('script[data-ai-devtools="overlay"][src]');
  if (marked instanceof HTMLScriptElement && marked.src) return marked.src;
  const scripts = document.querySelectorAll('script[src]');
  for (let index = scripts.length - 1; index >= 0; index -= 1) {
    const script = scripts[index];
    if (script instanceof HTMLScriptElement && /(?:^|\/)overlay\.js(?:\?|#|$)/.test(script.src)) {
      return script.src;
    }
  }
  return '';
}

function boot(): void {
  const src = overlayScriptUrl();
  if (!src) {
    console.warn('[aidev] overlay loader could not find its script URL');
    return;
  }
  const appUrl = new URL('./overlay/app.js', src).href;
  void import(appUrl).catch((error: unknown) => {
    console.warn('[aidev] overlay failed to load', error);
  });
}

if (typeof document !== 'undefined') {
  boot();
}
