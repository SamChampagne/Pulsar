import { describe, it, expect } from 'vitest';
import { deriveAccent, isHexColor, APPEARANCE_THEMES } from './appearance';

describe('isHexColor', () => {
  it('accepts #rgb and #rrggbb', () => {
    expect(isHexColor('#f1700f')).toBe(true);
    expect(isHexColor('#abc')).toBe(true);
  });
  it('rejects junk', () => {
    expect(isHexColor('red')).toBe(false);
    expect(isHexColor('#12')).toBe(false);
    expect(isHexColor('#gggggg')).toBe(false);
    expect(isHexColor('')).toBe(false);
  });
});

describe('deriveAccent', () => {
  it('returns three valid hex colors', () => {
    const v = deriveAccent('#f1700f');
    expect(v.accent.toLowerCase()).toBe('#f1700f');
    expect(isHexColor(v.hover)).toBe(true);
    expect(isHexColor(v.soft)).toBe(true);
  });
  it('hover is darker than accent and soft is lighter', () => {
    const lum = (h: string) => {
      const n = h.replace('#', '');
      return parseInt(n.slice(0, 2), 16) + parseInt(n.slice(2, 4), 16) + parseInt(n.slice(4, 6), 16);
    };
    const v = deriveAccent('#3366cc');
    expect(lum(v.hover)).toBeLessThan(lum('#3366cc'));
    expect(lum(v.soft)).toBeGreaterThan(lum('#3366cc'));
  });
  it('normalizes #rgb to #rrggbb', () => {
    expect(deriveAccent('#abc').accent).toBe('#aabbcc');
  });
});

describe('APPEARANCE_THEMES', () => {
  it('lists warm/cool/dark', () => {
    expect(APPEARANCE_THEMES).toEqual(['warm', 'cool', 'dark']);
  });
});
