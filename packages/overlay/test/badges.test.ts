import { afterEach, describe, expect, it, vi } from 'vitest';
import { BADGE_LAYER_ID, SelectionBadges } from '../src/inspector/badges.js';

describe('selection badges', () => {
  afterEach(() => {
    document.getElementById(BADGE_LAYER_ID)?.remove();
    document.body.replaceChildren();
  });

  it('places each badge outside the element top-left, clamped to the viewport', () => {
    const price = document.createElement('strong');
    price.textContent = '$86';
    document.body.append(price);
    vi.spyOn(price, 'getBoundingClientRect').mockReturnValue(new DOMRect(40, 30, 29, 22));
    const badges = new SelectionBadges();
    badges.set([price]);
    const badge = document.querySelector(`#${BADGE_LAYER_ID} div`) as HTMLDivElement;
    expect(badge.textContent).toBe('1');
    expect(badge.style.width).toBe('18px');
    expect(badge.style.height).toBe('18px');
    expect(badge.style.top).toBe('20px');
    expect(badge.style.left).toBe('30px');
    expect(badge.style.boxShadow).toContain('0 0 0 1px');
    badges.stop();
  });
});
