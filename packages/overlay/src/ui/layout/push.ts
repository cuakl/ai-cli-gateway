export interface PushSnapshot {
  marginRight: string;
  paddingBottom: string;
}

export function snapshotDocumentPush(el: HTMLElement = document.documentElement): PushSnapshot {
  return {
    marginRight: el.style.marginRight,
    paddingBottom: el.style.paddingBottom,
  };
}

export function applyDocumentPush(
  el: HTMLElement,
  snapshot: PushSnapshot,
  sidePx: number,
  bottomPx: number,
  enabled: boolean,
): void {
  if (!enabled) {
    restoreDocumentPush(el, snapshot);
    return;
  }
  el.style.marginRight = sidePx > 0 ? `${sidePx}px` : snapshot.marginRight;
  el.style.paddingBottom = bottomPx > 0 ? `${bottomPx}px` : snapshot.paddingBottom;
}

export function restoreDocumentPush(el: HTMLElement, snapshot: PushSnapshot): void {
  el.style.marginRight = snapshot.marginRight;
  el.style.paddingBottom = snapshot.paddingBottom;
}
