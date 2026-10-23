export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  if (uaData?.platform) return /mac|iphone|ipad/i.test(uaData.platform);
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');
}

export function isModKey(event: KeyboardEvent): boolean {
  return isApplePlatform() ? event.metaKey : event.ctrlKey;
}

export function sendShortcutHint(): string {
  return isApplePlatform() ? '⌘ Enter' : 'Ctrl Enter';
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const type = (target as HTMLInputElement).type;
  return !['button', 'checkbox', 'radio', 'range', 'file', 'submit', 'reset', 'color', 'hidden', 'image'].includes(
    type,
  );
}

export function eventInsideOverlay(event: Event, host: EventTarget | null): boolean {
  if (!host) return false;
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  return path.includes(host);
}

export function isPaletteChord(event: KeyboardEvent): boolean {
  return isModKey(event) && event.key.toLowerCase() === 'k' && !event.shiftKey && !event.altKey;
}

export function isInspectChord(event: KeyboardEvent): boolean {
  return isModKey(event) && event.shiftKey && event.key.toLowerCase() === 'c' && !event.altKey;
}

export function isStopChord(event: KeyboardEvent): boolean {
  return isModKey(event) && event.key === '.' && !event.shiftKey && !event.altKey;
}
