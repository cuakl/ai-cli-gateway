import { logger } from '@aidev/adapters';
import type { Provider } from '@aidev/protocol';
import type { ServerDeps } from '../types.js';

/** Cursor and Claude report `supportsResume`. A probe failure falls back to a transcript. */
export async function providerSupportsResume(deps: ServerDeps, provider: Provider): Promise<boolean> {
  try {
    const listed = await deps.runtime.listCapabilities();
    return listed.find((item) => item.provider === provider)?.supportsResume === true;
  } catch (error) {
    logger.error(error instanceof Error ? error.message : 'provider capabilities failed');
    return false;
  }
}
