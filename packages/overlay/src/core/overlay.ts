import { h, render } from 'preact';
import { GLOBAL_CONFIG_KEY } from '../brand.js';
import { installContextCollectors } from '../context/index.js';
import { OVERLAY_CSS } from '../styles.js';
import { DEFAULT_GATEWAY_URL, OVERLAY_TAG, type DevtoolsConfig, type OverlayTheme } from '../types.js';
import { App } from '../ui/App.js';
import {
  AID_FONT,
  AID_Z_HOST,
  DARK_PALETTE,
  LIGHT_PALETTE,
  parseTheme,
} from '../ui/theme/tokens.js';

interface InjectedDevtoolsConfig {
  gatewayUrl?: string;
  projectName?: string;
  projectId?: string;
  browserToken?: string;
  theme?: OverlayTheme;
}

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
    if (this.isConnected) {
      this.applyHostStyles();
      this.paint();
    }
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
    const injected = readInjectedConfig();
    return {
      gatewayUrl:
        nonempty(this.config.gatewayUrl) ??
        nonempty(this.getAttribute('gateway-url')) ??
        nonempty(injected.gatewayUrl) ??
        DEFAULT_GATEWAY_URL,
      projectId:
        nonempty(this.config.projectId) ??
        nonempty(this.getAttribute('project-id')) ??
        nonempty(injected.projectId),
      browserToken:
        nonempty(this.config.browserToken) ??
        nonempty(this.getAttribute('browser-token')) ??
        nonempty(injected.browserToken),
      projectName: nonempty(this.config.projectName) ?? nonempty(injected.projectName),
      theme: this.resolvedTheme(injected),
      workspace: this.config.workspace,
    };
  }

  private resolvedTheme(injected = readInjectedConfig()): OverlayTheme {
    return (
      parseTheme(this.config.theme) ??
      parseTheme(injected.theme) ??
      parseTheme(this.getAttribute('data-theme')) ??
      'dark'
    );
  }

  private applyHostStyles(): void {
    const theme = this.resolvedTheme();
    this.setAttribute('data-theme', theme);
    const prefersLight =
      theme === 'light' ||
      (theme === 'system' &&
        typeof matchMedia === 'function' &&
        matchMedia('(prefers-color-scheme: light)').matches);
    const palette = prefersLight ? LIGHT_PALETTE : DARK_PALETTE;
    const style = this.style;
    // `all: initial` keeps the host page from painting this element, but it also
    // resets color and font to the UA initial values (black, usually a serif).
    // Those two have to be set again afterwards or the shadow tree inherits them.
    style.setProperty('all', 'initial');
    style.setProperty('position', 'fixed');
    style.setProperty('top', '0');
    style.setProperty('right', '0');
    style.setProperty('bottom', '0');
    style.setProperty('left', '0');
    style.setProperty('z-index', String(AID_Z_HOST));
    style.setProperty('pointer-events', 'none');
    style.setProperty('display', 'block');
    style.setProperty('color-scheme', theme === 'light' ? 'light' : theme === 'system' ? 'light dark' : 'dark');
    style.setProperty('font-family', AID_FONT);
    style.setProperty('font-size', '14px');
    style.setProperty('line-height', '1.5');
    style.setProperty('font-weight', '400');
    style.setProperty('letter-spacing', '-0.011em');
    style.setProperty('color', palette.text);
    style.setProperty('-webkit-font-smoothing', 'antialiased');
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

function readInjectedConfig(): InjectedDevtoolsConfig {
  const host = globalThis as { [GLOBAL_CONFIG_KEY]?: InjectedDevtoolsConfig };
  return host[GLOBAL_CONFIG_KEY] ?? {};
}

function nonempty(value: string | null | undefined): string | undefined {
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
