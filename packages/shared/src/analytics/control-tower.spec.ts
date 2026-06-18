import { describe, it, expect } from 'vitest';
import {
  computeOtif,
  computeFleetAvailability,
  avg,
  sortAttention,
} from './control-tower';
import type { AttentionItem } from './control-tower';

// ---------------------------------------------------------------------------
// computeOtif
// ---------------------------------------------------------------------------
describe('computeOtif', () => {
  it('returns percentage of on-time rows (1 decimal)', () => {
    const rows = [
      { onTime: true },
      { onTime: true },
      { onTime: false },
      { onTime: true },
    ];
    expect(computeOtif(rows)).toBe(75.0);
  });

  it('returns null when total is 0', () => {
    expect(computeOtif([])).toBeNull();
  });

  it('returns 100 when all deliveries are on time', () => {
    expect(computeOtif([{ onTime: true }, { onTime: true }])).toBe(100.0);
  });

  it('returns 0 when no deliveries are on time', () => {
    expect(computeOtif([{ onTime: false }, { onTime: false }])).toBe(0.0);
  });

  it('rounds to 1 decimal place', () => {
    // 1 out of 3 = 33.333...% → 33.3
    expect(computeOtif([{ onTime: true }, { onTime: false }, { onTime: false }])).toBe(33.3);
  });
});

// ---------------------------------------------------------------------------
// computeFleetAvailability
// ---------------------------------------------------------------------------
describe('computeFleetAvailability', () => {
  it('returns availability percentage', () => {
    expect(computeFleetAvailability({ available: 3, total: 4 })).toBe(75.0);
  });

  it('returns null when total is 0', () => {
    expect(computeFleetAvailability({ available: 0, total: 0 })).toBeNull();
  });

  it('returns 100 when all assets are available', () => {
    expect(computeFleetAvailability({ available: 5, total: 5 })).toBe(100.0);
  });

  it('returns 0 when no assets are available', () => {
    expect(computeFleetAvailability({ available: 0, total: 4 })).toBe(0.0);
  });

  it('rounds to 1 decimal place', () => {
    // 1/3 = 33.333...% → 33.3
    expect(computeFleetAvailability({ available: 1, total: 3 })).toBe(33.3);
  });
});

// ---------------------------------------------------------------------------
// avg
// ---------------------------------------------------------------------------
describe('avg', () => {
  it('returns mean of values', () => {
    expect(avg([10, 20, 30])).toBe(20);
  });

  it('returns null for empty array', () => {
    expect(avg([])).toBeNull();
  });

  it('returns the single value when array has one element', () => {
    expect(avg([42])).toBe(42);
  });

  it('handles decimal values', () => {
    expect(avg([1, 2])).toBe(1.5);
  });
});

// ---------------------------------------------------------------------------
// sortAttention
// ---------------------------------------------------------------------------
describe('sortAttention', () => {
  const makeItem = (
    severity: AttentionItem['severity'],
    at?: string,
    label = 'x',
  ): AttentionItem => ({
    kind: 'load_late',
    severity,
    label,
    at,
  });

  it('orders critical before warning before info', () => {
    const items: AttentionItem[] = [
      makeItem('info', '2024-01-03'),
      makeItem('critical', '2024-01-01'),
      makeItem('warning', '2024-01-02'),
    ];
    const sorted = sortAttention(items);
    expect(sorted.map((i) => i.severity)).toEqual(['critical', 'warning', 'info']);
  });

  it('within the same severity, orders by at descending (newest first)', () => {
    const items: AttentionItem[] = [
      makeItem('warning', '2024-01-01'),
      makeItem('warning', '2024-01-03'),
      makeItem('warning', '2024-01-02'),
    ];
    const sorted = sortAttention(items);
    expect(sorted.map((i) => i.at)).toEqual(['2024-01-03', '2024-01-02', '2024-01-01']);
  });

  it('places items without at last within their severity group', () => {
    const items: AttentionItem[] = [
      makeItem('warning', undefined, 'no-at'),
      makeItem('warning', '2024-01-01', 'has-at'),
    ];
    const sorted = sortAttention(items);
    expect(sorted[0].label).toBe('has-at');
    expect(sorted[1].label).toBe('no-at');
  });

  it('does not mutate the input array', () => {
    const items: AttentionItem[] = [
      makeItem('info'),
      makeItem('critical'),
    ];
    const original = [...items];
    sortAttention(items);
    expect(items[0].severity).toBe(original[0].severity);
    expect(items[1].severity).toBe(original[1].severity);
  });

  it('handles mixed severities with missing at values correctly', () => {
    const items: AttentionItem[] = [
      makeItem('info', '2024-06-01', 'info-with-at'),
      makeItem('critical', undefined, 'critical-no-at'),
      makeItem('warning', '2024-06-15', 'warning-with-at'),
      makeItem('critical', '2024-06-10', 'critical-with-at'),
      makeItem('info', undefined, 'info-no-at'),
    ];
    const sorted = sortAttention(items);
    expect(sorted[0].label).toBe('critical-with-at');
    expect(sorted[1].label).toBe('critical-no-at');
    expect(sorted[2].label).toBe('warning-with-at');
    expect(sorted[3].label).toBe('info-with-at');
    expect(sorted[4].label).toBe('info-no-at');
  });
});
