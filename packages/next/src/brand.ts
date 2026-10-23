/** Product naming. A rename is a find-and-replace of this module. */
export const PRODUCT_NAME = 'AI DevTools';
export const SCOPE = '@aidev';
export const CLI_NAME = 'aidev';
export const HOME_DIRNAME = '.aidev';

/** Key on `globalThis` injected into the page. */
export const GLOBAL_CONFIG_KEY = '__AI_DEVTOOLS__';

export const DEFAULT_ORIGIN = 'http://localhost:3000';
export const DEFAULT_GATEWAY_URL = 'http://127.0.0.1:4100';

export const ENV = {
  gatewayUrl: 'NEXT_PUBLIC_AIDEV_GATEWAY_URL',
  projectId: 'NEXT_PUBLIC_AIDEV_PROJECT_ID',
  browserToken: 'NEXT_PUBLIC_AIDEV_BROWSER_TOKEN',
  projectName: 'NEXT_PUBLIC_AIDEV_PROJECT_NAME',
} as const;
