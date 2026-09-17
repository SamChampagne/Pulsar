import { describe, it, expect } from 'vitest';
import { formatTime } from './format';

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
