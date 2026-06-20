import { describe, it, expect } from 'vitest';
import {
  MODULE_SETTINGS_CATALOG,
  catalogFor,
  resolveSettings,
  validateSettings,
} from './module-settings';

const proc = catalogFor('procurement')!;

describe('catalog', () => {
  it('exposes a procurement catalog with bidUniqueness', () => {
    expect(proc).toBeDefined();
    expect(proc.settings.find((s) => s.key === 'bidUniqueness')).toBeDefined();
  });
  it('every enum descriptor has options and a default within them', () => {
    for (const cat of MODULE_SETTINGS_CATALOG) {
      for (const s of cat.settings) {
        if (s.type === 'enum') {
          expect(s.options && s.options.length).toBeTruthy();
          expect(s.options!.map((o) => o.value)).toContain(s.default);
        }
      }
    }
  });
});

describe('resolveSettings', () => {
  it('returns defaults when nothing stored', () => {
    const r = resolveSettings(proc, {});
    expect(r.bidUniqueness).toBe('MULTIPLE');
  });
  it('applies a valid stored override', () => {
    expect(resolveSettings(proc, { bidUniqueness: 'SINGLE' }).bidUniqueness).toBe('SINGLE');
  });
  it('ignores an invalid enum value and falls back to default', () => {
    expect(resolveSettings(proc, { bidUniqueness: 'NOPE' }).bidUniqueness).toBe('MULTIPLE');
  });
  it('ignores unknown stored keys', () => {
    const r = resolveSettings(proc, { evil: 'x' } as Record<string, unknown>);
    expect((r as Record<string, unknown>).evil).toBeUndefined();
  });
  it('ignores out-of-range numbers and falls back to default', () => {
    const fleet = catalogFor('fleet')!;
    expect(
      resolveSettings(fleet, { complianceExpiringWindowDays: -5 }).complianceExpiringWindowDays,
    ).toBe(30);
  });
});

describe('validateSettings', () => {
  it('accepts a valid patch', () => {
    const res = validateSettings(proc, { bidUniqueness: 'SINGLE' });
    expect(res.ok).toBe(true);
  });
  it('rejects an unknown key', () => {
    const res = validateSettings(proc, { evil: 1 });
    expect(res.ok).toBe(false);
  });
  it('rejects a bad enum value', () => {
    expect(validateSettings(proc, { bidUniqueness: 'NOPE' }).ok).toBe(false);
  });
  it('rejects a number below min', () => {
    const fleet = catalogFor('fleet')!;
    expect(validateSettings(fleet, { complianceExpiringWindowDays: 0 }).ok).toBe(false);
  });
});
