import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ElementPicker,
  HIGHLIGHT_ID,
  HIGHLIGHT_LABEL_ID,
  MARGIN_BOX_ID,
  PADDING_BOX_ID,
  describeElement,
  highlightFrame,
} from '../src/inspector/picker.js';

function rect(x: number, y: number, width: number, height: number): DOMRect {
  return new DOMRect(x, y, width, height);
}

describe('highlight geometry', () => {
  it('adds document scroll to the viewport rect', () => {
    expect(highlightFrame({ top: 20, left: 10, width: 320, height: 48 }, 5, 15)).toEqual({
      top: 35,
      left: 15,
      width: 320,
      height: 48,
    });
  });

  it('formats the dimension tooltip', () => {
    const element = document.createElement('div');
    element.id = 'id';
    element.className = 'class';
    expect(describeElement(element, { width: 320, height: 48 })).toBe('div#id.class (320x48)');
  });
});

describe('ElementPicker', () => {
  let picker: ElementPicker | null = null;

  afterEach(() => {
    picker?.stop();
    picker = null;
    document.getElementById(HIGHLIGHT_ID)?.remove();
    document.getElementById(HIGHLIGHT_LABEL_ID)?.remove();
    document.getElementById(MARGIN_BOX_ID)?.remove();
    document.getElementById(PADDING_BOX_ID)?.remove();
    document.documentElement.style.cursor = '';
    vi.restoreAllMocks();
  });

  it('positions the highlight from the element rect and scroll offsets', () => {
    const target = document.createElement('div');
    target.id = 'id';
    target.className = 'class';
    document.body.appendChild(target);
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(rect(10, 20, 320, 48));
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(target);
    vi.spyOn(window, 'scrollX', 'get').mockReturnValue(5);
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(15);

    picker = new ElementPicker({ onSelect: () => undefined });
    picker.start();
    expect(picker.active).toBe(true);
    expect(document.documentElement.style.cursor).toBe('crosshair');

    target.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 12, clientY: 22 }));

    const box = document.getElementById(HIGHLIGHT_ID);
    expect(box).toBeTruthy();
    expect(box?.style.pointerEvents).toBe('none');
    expect(box?.style.position).toBe('absolute');
    expect(box?.style.left).toBe('15px');
    expect(box?.style.top).toBe('35px');
    expect(box?.style.width).toBe('320px');
    expect(box?.style.height).toBe('48px');
    expect(box?.style.transition).toContain('top');
    const label = document.getElementById(HIGHLIGHT_LABEL_ID);
    expect(label?.textContent).toContain('div 320×48');
    expect(label?.style.fontFamily).toContain('ui-sans-serif');
    expect(label?.style.fontSize).toBe('12px');
    expect(label?.style.color.toLowerCase()).toBe('#e7e9ee');
    target.remove();
  });

  it('captures click before the host handler and selects the element', () => {
    const target = document.createElement('button');
    document.body.appendChild(target);
    let hostClicked = false;
    let laterCapture = false;
    target.addEventListener('click', () => {
      hostClicked = true;
    });
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(target);

    let selected: Element | null = null;
    picker = new ElementPicker({
      onSelect(element) {
        selected = element;
      },
    });
    picker.start();
    window.addEventListener(
      'click',
      () => {
        laterCapture = true;
      },
      true,
    );

    const event = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 4, clientY: 4 });
    target.dispatchEvent(event);

    expect(hostClicked).toBe(false);
    expect(laterCapture).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(selected).toBe(target);
    expect(picker.active).toBe(false);
    expect(document.getElementById(HIGHLIGHT_ID)).toBeNull();
    target.remove();
  });

  it('cancels on Escape without selecting', () => {
    let selected = false;
    let cancelled = false;
    picker = new ElementPicker({
      onSelect() {
        selected = true;
      },
      onCancel() {
        cancelled = true;
      },
    });
    picker.start();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(cancelled).toBe(true);
    expect(selected).toBe(false);
    expect(picker.active).toBe(false);
  });

  it('ignores the overlay host', () => {
    const host = document.createElement('ai-devtools');
    const inner = document.createElement('button');
    host.appendChild(inner);
    document.body.appendChild(host);
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(inner);

    let selected = false;
    picker = new ElementPicker({
      onSelect() {
        selected = true;
      },
    });
    picker.start();
    inner.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 1, clientY: 1 }));
    inner.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 1, clientY: 1 }));
    expect(selected).toBe(false);
    expect(document.getElementById(HIGHLIGHT_ID)).toBeNull();
    host.remove();
  });

  it('walks to a data-loc ancestor with ArrowUp', () => {
    const card = document.createElement('button');
    card.setAttribute('data-loc', 'src/CardGrid.tsx:21:1');
    const price = document.createElement('strong');
    price.setAttribute('data-loc', 'src/CardGrid.tsx:30:1');
    card.appendChild(price);
    document.body.appendChild(card);
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(price);
    vi.spyOn(price, 'getBoundingClientRect').mockReturnValue(rect(20, 20, 40, 16));
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue(rect(10, 10, 200, 80));

    picker = new ElementPicker({ onSelect: () => undefined });
    picker.start();
    price.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 22, clientY: 22 }));
    expect(picker.hoveredElement).toBe(price);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    expect(picker.hoveredElement).toBe(card);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(picker.hoveredElement).toBe(price);
    card.remove();
  });

  it('keeps inspecting on Shift+click so a second element can be added', () => {
    const first = document.createElement('div');
    const second = document.createElement('span');
    document.body.appendChild(first);
    document.body.appendChild(second);
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(first);
    const selected: Element[] = [];
    picker = new ElementPicker({
      onSelect(element, extras) {
        if (extras.shift) selected.push(element);
      },
    });
    picker.start();
    first.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 1, clientY: 1 }));
    first.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 1, clientY: 1, shiftKey: true }),
    );
    expect(picker.active).toBe(true);
    expect(selected).toEqual([first]);
    first.remove();
    second.remove();
  });

  it('does not swallow clicks on the overlay host while a page node is hovered', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const host = document.createElement('ai-devtools');
    const button = document.createElement('button');
    host.appendChild(button);
    document.body.appendChild(host);
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(target);
    let selected = false;
    picker = new ElementPicker({
      onSelect() {
        selected = true;
      },
    });
    picker.start();
    target.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 1, clientY: 1 }));
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 1, clientY: 1 });
    Object.defineProperty(click, 'composedPath', { value: () => [button, host] });
    button.dispatchEvent(click);
    expect(selected).toBe(false);
    expect(click.defaultPrevented).toBe(false);
    expect(picker.active).toBe(true);
    target.remove();
    host.remove();
  });

  it('opens the editor on alt+click without picking', () => {
    const target = document.createElement('button');
    document.body.appendChild(target);
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(target);
    let opened: Element | null = null;
    let selected = false;
    picker = new ElementPicker({
      onSelect() {
        selected = true;
      },
      onOpenEditor(element) {
        opened = element;
      },
    });
    picker.start();
    target.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 2, clientY: 2 }));
    target.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 2, clientY: 2, altKey: true }),
    );
    expect(opened).toBe(target);
    expect(selected).toBe(false);
    expect(picker.active).toBe(true);
    target.remove();
  });
});
