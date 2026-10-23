import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ElementPicker,
  HIGHLIGHT_ID,
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
    expect(box?.textContent).toBe('div#id.class (320x48)');
    const label = box?.firstElementChild as HTMLElement | null;
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
});
