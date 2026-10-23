import { afterEach, describe, expect, it, vi } from 'vitest';
import { getErrors, getViteError, uninstallContextCollectors } from '../src/context/index.js';
import { installViteCapture, setViteFixHandler, uninstallViteCapture } from '../src/context/vite.js';

describe('vite overlay capture', () => {
  afterEach(() => {
    uninstallViteCapture();
    uninstallContextCollectors();
    document.querySelectorAll('vite-error-overlay').forEach((node) => node.remove());
    if (customElements.get('vite-error-overlay')) {
      // happy-dom keeps the definition; reuse it.
    }
  });

  it('records a vite-error-overlay, injects Fix with AI, and clears when it is removed', async () => {
    defineOverlay();
    installViteCapture();
    const overlay = document.createElement('vite-error-overlay') as ViteOverlayElement;
    overlay.err = {
      message: 'Transform failed',
      stack: 'Error: Transform failed',
      loc: { file: 'src/App.tsx', line: 4, column: 1 },
    };
    document.body.append(overlay);
    await vi.waitFor(() => expect(getViteError()?.type).toBe('vite'));
    expect(getViteError()?.message).toContain('Transform failed');
    expect(getErrors().some((entry) => entry.type === 'vite')).toBe(true);
    const button = overlay.shadowRoot?.querySelector('[data-aid-fix]') as HTMLButtonElement;
    expect(button?.textContent).toBe('Fix with AI');

    let fixed: string | null = null;
    setViteFixHandler((error) => {
      fixed = error.message;
    });
    button.click();
    expect(fixed).toContain('Transform failed');

    overlay.remove();
    await vi.waitFor(() => expect(getViteError()).toBeNull());
    expect(getErrors().some((entry) => entry.type === 'vite')).toBe(false);
  });
});

interface ViteOverlayElement extends HTMLElement {
  err?: { message: string; stack?: string; loc?: { file: string; line: number; column: number } };
}

function defineOverlay(): void {
  if (customElements.get('vite-error-overlay')) return;
  class ViteErrorOverlay extends HTMLElement {
    constructor() {
      super();
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML =
        '<pre class="message">Transform failed</pre><pre class="file">src/App.tsx</pre><pre class="frame">code</pre><pre class="stack">Error: Transform failed</pre>';
    }
  }
  customElements.define('vite-error-overlay', ViteErrorOverlay);
}
