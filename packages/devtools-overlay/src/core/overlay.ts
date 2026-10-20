import { h, render } from 'preact';
import { installContextCollectors } from '../context/index.js';
import { OVERLAY_CSS } from '../styles.js';
import { DEFAULT_GATEWAY_URL, OVERLAY_TAG, type DevtoolsConfig } from '../types.js';
import { App } from '../ui/App.js';
import { readDevtoolsWindowConfig } from '../ui/bridge.js';

export class AiDevtoolsElement extends HTMLElement {
  private readonly shadow: ShadowRoot;
  private mountPoint: HTMLDivElement | null = null;
  private config: DevtoolsConfig = {};

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  configure(config: DevtoolsConfig): void {
    this.config = { ...this.config, ...config };
    if (this.isConnected) this.paint();
  }

  connectedCallback(): void {
    this.applyHostStyles();
    this.ensureStyle();
    this.ensureMount();
    installContextCollectors({ gatewayUrl: this.resolvedConfig().gatewayUrl });
    this.paint();
  }

  disconnectedCallback(): void {
    if (this.mountPoint) render(null, this.mountPoint);
  }

  private resolvedConfig(): DevtoolsConfig {
    const injected = readDevtoolsWindowConfig();
    return {
      ...this.config,
      gatewayUrl:
        this.config.gatewayUrl ??
        this.getAttribute('gateway-url') ??
        nonempty(injected.gatewayUrl) ??
        DEFAULT_GATEWAY_URL,
      cwd: this.config.cwd ?? this.getAttribute('cwd') ?? nonempty(injected.cwd) ?? '.',
    };
  }

  private applyHostStyles(): void {
    this.style.setProperty('all', 'initial');
    this.style.position = 'fixed';
    this.style.top = '0';
    this.style.right = '0';
    this.style.bottom = '0';
    this.style.left = '0';
    this.style.zIndex = '2147483647';
    this.style.pointerEvents = 'none';
    this.style.display = 'block';
  }

  private ensureStyle(): void {
    if (this.shadow.querySelector('style[data-ai-devtools]')) return;
    const style = document.createElement('style');
    style.dataset.aiDevtools = 'overlay';
    style.textContent = OVERLAY_CSS;
    this.shadow.appendChild(style);
  }

  private ensureMount(): void {
    if (this.mountPoint?.isConnected) return;
    const root = document.createElement('div');
    root.id = 'ai-devtools-root';
    this.shadow.appendChild(root);
    this.mountPoint = root;
  }

  private paint(): void {
    if (!this.mountPoint) return;
    render(h(App, { config: this.resolvedConfig() }), this.mountPoint);
  }
}

export function defineAiDevtools(): void {
  if (typeof customElements === 'undefined') return;
  if (customElements.get(OVERLAY_TAG)) return;
  customElements.define(OVERLAY_TAG, AiDevtoolsElement);
}

function nonempty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function initDevtools(config: DevtoolsConfig = {}): AiDevtoolsElement | null {
  if (typeof document === 'undefined') return null;
  defineAiDevtools();
  if (!document.body) {
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        initDevtools(config);
      },
      { once: true },
    );
    return null;
  }
  const existing = document.querySelector(OVERLAY_TAG);
  const element =
    existing instanceof AiDevtoolsElement ? existing : document.createElement(OVERLAY_TAG);
  if (!(element instanceof AiDevtoolsElement)) return null;
  element.configure(config);
  if (!element.isConnected) document.body.appendChild(element);
  return element;
}
