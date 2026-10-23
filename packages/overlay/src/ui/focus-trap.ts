const FOCUSABLE = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function focusableElements(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.getAttribute('aria-hidden') !== 'true' && el.tabIndex !== -1,
  );
}

export function trapFocus(container: HTMLElement): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab') return;
    const items = focusableElements(container);
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const root = container.getRootNode();
    const active = root instanceof ShadowRoot ? root.activeElement : container.ownerDocument.activeElement;
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (event.shiftKey) {
      if (active === first || !container.contains(active)) {
        event.preventDefault();
        last.focus();
      }
      return;
    }
    if (active === last || !container.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  };
  container.addEventListener('keydown', onKeyDown);
  return () => container.removeEventListener('keydown', onKeyDown);
}
