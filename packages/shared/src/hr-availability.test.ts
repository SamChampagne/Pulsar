import { describe, expect, it } from 'vitest';
import { hrAvailabilityDate } from './hr-availability';

describe('RH availability civil-day projection', () => {
  it('uses the explicitly displayed zone, not the server or UTC date', () => {
    expect(hrAvailabilityDate('2030-01-02T02:30:00Z', 'America/Toronto')).toBe('2030-01-01');
    expect(hrAvailabilityDate('2030-01-02T02:30:00Z', 'UTC')).toBe('2030-01-02');
    expect(hrAvailabilityDate('2030-01-01T23:30:00-05:00', 'Asia/Tokyo')).toBe('2030-01-02');
  });
  it('handles both daylight-saving switches', () => {
    for (const t of ['2026-03-08T06:59:00Z', '2026-03-08T07:01:00Z'])
      expect(hrAvailabilityDate(t, 'America/Toronto')).toBe('2026-03-08');
    for (const t of ['2026-11-01T05:30:00Z', '2026-11-01T06:30:00Z'])
      expect(hrAvailabilityDate(t, 'America/Toronto')).toBe('2026-11-01');
  });
  it.each([
    '2030-02-30T12:00:00Z',
    '2030-01-01T25:00:00Z',
    '2030-01-01T12:00:00',
    '1899-12-31T12:00:00Z',
    '2200-01-01T12:00:00Z',
  ])('rejects invalid/out-of-contract instant %s', (instant) => {
    expect(() => hrAvailabilityDate(instant, 'UTC')).toThrow();
  });
  it.each(['', 'Mars/Olympus'])('rejects missing/unknown timezones %s', (zone) => {
    expect(() => hrAvailabilityDate('2030-01-01T12:00:00Z', zone)).toThrow();
  });
});
