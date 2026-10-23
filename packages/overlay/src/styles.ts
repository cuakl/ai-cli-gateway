import { BASE_CSS } from './ui/styles/base.js';
import { CHAT_CSS } from './ui/styles/chat.js';
import { DIFF_CSS } from './ui/styles/diff.js';
import { INSPECTOR_BANNER_CSS } from './ui/styles/inspector-banner.js';
import { NOTICE_CSS } from './ui/styles/notice.js';
import { TERMINAL_CSS } from './ui/styles/terminal.js';
import { TESTS_CSS } from './ui/styles/tests.js';
import { TOOLBAR_CSS } from './ui/styles/toolbar.js';
import { AID_FONT, AID_MONO, DARK_PALETTE, THEME_CSS } from './ui/theme/tokens.js';

/** Shared with the host inline style. `all: initial` would otherwise leave a serif and black text. */
export const OVERLAY_FONT = AID_FONT;

export const OVERLAY_MONO = AID_MONO;

export const OVERLAY_TEXT = DARK_PALETTE.text;

/** Injected into the shadow root so host-page CSS cannot restyle the overlay. */
export const OVERLAY_CSS = [
  THEME_CSS,
  BASE_CSS,
  TOOLBAR_CSS,
  INSPECTOR_BANNER_CSS,
  CHAT_CSS,
  DIFF_CSS,
  TERMINAL_CSS,
  TESTS_CSS,
  NOTICE_CSS,
].join('\n');
