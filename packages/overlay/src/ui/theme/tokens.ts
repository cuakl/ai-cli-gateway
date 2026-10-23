export const AID_FONT =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export const AID_MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

export const AID_Z_HOST = 2_147_483_600;

export interface ThemePalette {
  bg: string;
  bgRaised: string;
  bgHover: string;
  border: string;
  text: string;
  textMuted: string;
  accent: string;
  accentFg: string;
  accentSolid: string;
  dangerSolid: string;
  success: string;
  warning: string;
  danger: string;
  addBg: string;
  delBg: string;
  shadowLg: string;
}

export const DARK_PALETTE: ThemePalette = {
  bg: '#0f1115',
  bgRaised: '#161921',
  bgHover: '#1d212b',
  border: '#262b36',
  text: '#e7e9ee',
  textMuted: '#9aa3b2',
  accent: '#7c6cff',
  accentFg: '#fff',
  accentSolid: '#6a5af9',
  dangerSolid: '#c93a3c',
  success: '#3ecf8e',
  warning: '#f5a524',
  danger: '#f05d5e',
  addBg: 'rgba(62, 207, 142, 0.14)',
  delBg: 'rgba(240, 93, 94, 0.14)',
  shadowLg: '0 12px 40px rgba(0, 0, 0, 0.35)',
};

export const LIGHT_PALETTE: ThemePalette = {
  bg: '#f4f5f8',
  bgRaised: '#ffffff',
  bgHover: '#e8eaef',
  border: '#c9ced8',
  text: '#1a1d24',
  textMuted: '#5b6573',
  accent: '#5b4ce6',
  accentFg: '#fff',
  accentSolid: '#5b4ce6',
  dangerSolid: '#b4232c',
  success: '#0f7a4a',
  warning: '#8a5a00',
  danger: '#b4232c',
  addBg: 'rgba(62, 207, 142, 0.14)',
  delBg: 'rgba(240, 93, 94, 0.14)',
  shadowLg: '0 12px 40px rgba(0, 0, 0, 0.18)',
};

export type OverlayTheme = 'dark' | 'light' | 'system';

export function parseTheme(value: unknown): OverlayTheme | undefined {
  if (value === 'dark' || value === 'light' || value === 'system') return value;
  return undefined;
}

function paletteCustomProperties(palette: ThemePalette): string {
  return `
  --aid-bg: ${palette.bg};
  --aid-bg-raised: ${palette.bgRaised};
  --aid-bg-hover: ${palette.bgHover};
  --aid-border: ${palette.border};
  --aid-text: ${palette.text};
  --aid-text-muted: ${palette.textMuted};
  --aid-accent: ${palette.accent};
  --aid-accent-fg: ${palette.accentFg};
  --aid-accent-solid: ${palette.accentSolid};
  --aid-danger-solid: ${palette.dangerSolid};
  --aid-success: ${palette.success};
  --aid-warning: ${palette.warning};
  --aid-danger: ${palette.danger};
  --aid-add-bg: ${palette.addBg};
  --aid-del-bg: ${palette.delBg};
  --aid-shadow-lg: ${palette.shadowLg};
`.trimEnd();
}

export const THEME_CSS = `
:host {
  --aid-font: ${AID_FONT};
  --aid-mono: ${AID_MONO};
  --aid-text-xs: 12px;
  --aid-text-sm: 13px;
  --aid-text-md: 14px;
  --aid-text-lg: 16px;
  --aid-text-xl: 18px;
  --aid-line: 1.5;
  --aid-space-1: 4px;
  --aid-space-2: 8px;
  --aid-space-3: 12px;
  --aid-space-4: 16px;
  --aid-space-5: 24px;
  --aid-space-6: 32px;
  --aid-radius-sm: 6px;
  --aid-radius-md: 10px;
  --aid-radius-lg: 14px;
  --aid-radius-full: 999px;
  --aid-ease: cubic-bezier(.2, .8, .2, 1);
  --aid-dur: 160ms;
  --aid-dur-spin: 800ms;
  --aid-z: ${AID_Z_HOST};
  --aid-z-highlight: 10;
  --aid-z-dock: 20;
  --aid-z-popover: 30;
  --aid-z-toast: 40;
  --aid-z-modal: 50;
${paletteCustomProperties(DARK_PALETTE)}
}

:host([data-theme='light']) {
${paletteCustomProperties(LIGHT_PALETTE)}
}

@media (prefers-color-scheme: light) {
  :host([data-theme='system']) {
${paletteCustomProperties(LIGHT_PALETTE)}
  }
}

@media (prefers-reduced-motion: reduce) {
  :host {
    --aid-dur: 0ms;
    --aid-dur-spin: 0ms;
  }
}
`;
