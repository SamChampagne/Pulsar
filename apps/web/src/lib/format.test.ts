import { describe, it, expect } from 'vitest';
import { formatTime, formatDate, formatDateTime } from './format';
import { userTimeZone } from './stores/time-zone.svelte';
import { afterEach } from 'vitest';
afterEach(() => userTimeZone.load(null));

it('uses the user zone, distinguishes DST and leaves civil dates unchanged', () => {
  userTimeZone.load('America/Toronto');
  expect(formatTime('2026-01-15T15:00:00Z')).toContain('10 h 00');
  expect(formatTime('2026-07-15T15:00:00Z')).toContain('11 h 00');
  const early = formatDateTime('2026-11-01T05:30:00Z');
  const late = formatDateTime('2026-11-01T06:30:00Z');
  expect(early).not.toEqual(late);
  userTimeZone.load('America/Vancouver');
  expect(formatTime('2026-07-15T15:00:00Z')).toContain('08 h 00');
  expect(formatDate('2026-01-01')).toBe('2026-01-01');
  expect(formatDateTime('bad')).toBe('—');
});

describe('formatTime', () => {
  it('formats a fixed ISO instant as fr-CA 24h clock ("H h mm", no AM/PM)', () => {
    // The exact hour depends on the runner's timezone (a zulu instant), so
    // only the fr-CA *shape* is asserted here — the fixture is deterministic
    // enough (fixed instant) that this is still a real regression guard for
    // locale/format drift, just not for a specific wall-clock value.
    const result = formatTime('2026-09-16T14:02:00Z');
    expect(result).toMatch(/^\d{1,2} h \d{2}$/);
    expect(result).not.toContain('AM');
    expect(result).not.toContain('PM');
  });

  it('falls back to the em-dash placeholder for null/undefined/empty input', () => {
    expect(formatTime(null)).toBe('—');
    expect(formatTime(undefined)).toBe('—');
    expect(formatTime('')).toBe('—');
  });

  it('falls back to the em-dash placeholder for an unparseable date string', () => {
    expect(formatTime('not-a-date')).toBe('—');
  });
});
