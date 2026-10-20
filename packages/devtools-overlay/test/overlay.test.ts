import { toPng } from 'html-to-image';
import { options } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';

options.debounceRendering = (callback) => {
  callback();
};
import { uninstallContextCollectors } from '../src/context/index.js';
import { HIGHLIGHT_ID } from '../src/inspector/picker.js';
import { initDevtools } from '../src/index.js';
import type { GatewayBridge } from '../src/types.js';

vi.mock('html-to-image', () => ({
  toPng: vi.fn(async () => 'data:image/png;base64,overlay'),
}));

describe('initDevtools', () => {
  afterEach(() => {
    uninstallContextCollectors();
    document.querySelector('ai-devtools')?.remove();
    document.getElementById(HIGHLIGHT_ID)?.remove();
    document.documentElement.style.cursor = '';
    vi.restoreAllMocks();
  });

  it('mounts one shadow root and does not duplicate the host', () => {
    const first = initDevtools({ gatewayUrl: 'http://127.0.0.1:4100', client: fakeClient() });
    const second = initDevtools({ client: fakeClient() });
    expect(first).toBe(second);
    expect(document.querySelectorAll('ai-devtools')).toHaveLength(1);
    const shadow = first?.shadowRoot;
    expect(shadow?.querySelector('#ai-devtools-root')).toBeTruthy();
    expect(shadow?.querySelector('style')?.textContent).toContain('#ai-devtools-root');
    expect(shadow?.querySelector('[data-action="inspect"]')).toBeTruthy();
    expect(document.querySelector('#ai-devtools-root')).toBeNull();
  });

  it('inspects an element and streams the gateway reply into the drawer', async () => {
    const seen: string[] = [];
    const client: GatewayBridge = {
      async checkHealth() {
        return true;
      },
      async streamPrompt(input) {
        seen.push(input.prompt);
        expect(input.context?.selectedElement?.tagName).toBe('BUTTON');
        expect(input.context?.screenshotBase64).toContain('base64');
        input.onChunk?.('Updated the button');
        input.onDone?.();
      },
      cancel() {},
    };
    const host = initDevtools({ client, cwd: '/repo' });
    const shadow = host?.shadowRoot;
    expect(shadow).toBeTruthy();

    const inspect = shadow?.querySelector('[data-action="inspect"]') as HTMLButtonElement;
    inspect.click();
    expect(inspect.getAttribute('aria-pressed')).toBe('true');

    const button = document.createElement('button');
    button.id = 'hero';
    button.className = 'btn';
    button.textContent = 'Get started';
    button.setAttribute('data-loc', 'src/components/Hero.tsx:42:5');
    Object.assign(button, {
      __reactFiber$demo: {
        return: {
          type: { displayName: 'HeroButton' },
          memoizedProps: { tone: 'primary' },
          _debugSource: {
            fileName: 'src/components/Hero.tsx',
            lineNumber: 42,
            columnNumber: 5,
          },
        },
      },
    });
    document.body.appendChild(button);
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 320, 48));
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(button);
    let hostClicked = false;
    button.addEventListener('click', () => {
      hostClicked = true;
    });

    button.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 12, clientY: 22 }));
    const highlight = document.getElementById(HIGHLIGHT_ID);
    expect(highlight?.textContent).toContain('button#hero.btn (320x48)');
    expect(highlight?.style.pointerEvents).toBe('none');

    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 12, clientY: 22 }));
    expect(hostClicked).toBe(false);
    expect(shadow?.textContent).toContain('[HeroButton - Hero.tsx:42]');

    const suggestion = [...(shadow?.querySelectorAll('button') ?? [])].find(
      (node) => node.textContent === 'Fix layout',
    );
    suggestion?.click();
    const textarea = shadow?.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.value).toBe('Fix layout');
    textarea.value = 'Make it emerald';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    const send = shadow?.querySelector('[data-action="send"]') as HTMLButtonElement;
    send.click();
    await vi.waitFor(() => expect(shadow?.textContent).toContain('Updated the button'));
    expect(seen).toEqual(['Make it emerald']);
    expect(toPng).toHaveBeenCalled();
    button.remove();
  });
});

function fakeClient(): GatewayBridge {
  return {
    async checkHealth() {
      return false;
    },
    async streamPrompt() {},
    cancel() {},
  };
}
