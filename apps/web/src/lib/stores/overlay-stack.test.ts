import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  hasOpenOverlay,
  isTopOverlay,
  lockScroll,
  popOverlay,
  pushOverlay,
  unlockScroll,
} from './overlay-stack';

const tokens: symbol[] = [];
beforeEach(() => {
  document.body.innerHTML = '<main data-workspace-scroll style="overflow: auto"></main>';
  document.body.style.overflow = 'scroll';
});
afterEach(() => {
  for (const token of tokens.splice(0)) popOverlay(token);
  unlockScroll();
  unlockScroll();
  unlockScroll();
  document.body.innerHTML = '';
  document.body.style.overflow = '';
});

describe('shared overlay ownership', () => {
  it('only the last overlay owns keyboard dismissal, even when a middle overlay unmounts', () => {
    const first = pushOverlay(),
      middle = pushOverlay(),
      last = pushOverlay();
    tokens.push(first, middle, last);
    expect(hasOpenOverlay()).toBe(true);
    expect(isTopOverlay(first)).toBe(false);
    expect(isTopOverlay(last)).toBe(true);
    popOverlay(middle);
    expect(isTopOverlay(last)).toBe(true);
    popOverlay(last);
    expect(isTopOverlay(first)).toBe(true);
    popOverlay(first);
    expect(hasOpenOverlay()).toBe(false);
  });

  it('locks both document and work surface until the final nested panel closes', () => {
    const main = document.querySelector<HTMLElement>('main')!;
    lockScroll();
    lockScroll();
    expect(document.body.style.overflow).toBe('hidden');
    expect(main.style.overflow).toBe('hidden');
    unlockScroll();
    expect(main.style.overflow).toBe('hidden');
    unlockScroll();
    expect(document.body.style.overflow).toBe('scroll');
    expect(main.style.overflow).toBe('auto');
    unlockScroll();
    expect(main.style.overflow).toBe('auto');
  });

  it('supports public pages without a work surface', () => {
    document.body.innerHTML = '';
    lockScroll();
    expect(document.body.style.overflow).toBe('hidden');
    unlockScroll();
    expect(document.body.style.overflow).toBe('scroll');
  });
});
