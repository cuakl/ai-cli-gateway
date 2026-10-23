/**
 * Overlay chat modules are not exported from `@aidev/overlay` yet.
 * Import the source files directly so the dashboard reuses the reducer,
 * markdown renderer, and transcript without copying them.
 */
export { Markdown } from '../../overlay/src/ui/chat/markdown.js';
export { hydrateFromThread } from '../../overlay/src/ui/chat/model.js';
export type { ChatState, TurnItem } from '../../overlay/src/ui/chat/model.js';
export { Transcript } from '../../overlay/src/ui/chat/Transcript.js';
