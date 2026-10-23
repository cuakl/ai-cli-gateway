import { initDevtools } from './index.js';

export {
  AiDevtoolsElement,
  DEFAULT_GATEWAY_URL,
  ElementPicker,
  GatewayClient,
  defineAiDevtools,
  gatherContext,
  getReactSource,
  initDevtools,
  locateElement,
} from './index.js';

function boot(): void {
  initDevtools();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => boot(), { once: true });
  } else {
    boot();
  }
}
