import { describe, expect, it } from 'vitest';
import { yardAppointmentConflicts, yardDateInZone, yardDayRange } from './workspace';
describe('Yard site-local days', () => {
  it.each([
    ['2026-03-08', 23],
    ['2026-11-01', 25],
    ['2026-09-14', 24],
  ])('%s respects DST', (date, hours) => {
    const range = yardDayRange(date as string, 'America/Toronto');
    expect((+new Date(range.end) - +new Date(range.start)) / 3600000).toBe(hours);
    expect(yardDateInZone(new Date(range.start), range.timeZone)).toBe(date);
  });
  it('falls back explicitly for missing/invalid zones', () => {
    expect(yardDayRange('2026-09-14', 'nonsense')).toMatchObject({
      timeZone: 'UTC',
      timezoneFallback: true,
    });
    expect(yardDayRange('2026-09-14', null).timezoneFallback).toBe(true);
  });
  it.each(['2026-02-30', 'not-a-date', '2026-1-1', '0000-01-01', '9999-12-31'])('rejects %s', (d) =>
    expect(() => yardDayRange(d, 'UTC')).toThrow(),
  );
  it('rejects a skipped calendar day instead of returning a zero-duration timeline', () => {
    expect(() => yardDayRange('2011-12-30', 'Pacific/Apia')).toThrow();
  });
});
describe('Yard advisory booking conflicts', () => {
  const a = {
    id: 'a',
    spotId: 'door',
    status: 'SCHEDULED',
    windowStart: '2026-09-14T10:00:00Z',
    windowEnd: '2026-09-14T11:00:00Z',
  };
  it('identifies both appointments, with offset-aware timestamps', () =>
    expect(
      yardAppointmentConflicts([a, { ...a, id: 'b', windowStart: '2026-09-14T06:30:00-04:00' }]),
    ).toEqual(['a', 'b']));
  it('excludes touching windows, terminal bookings and different/no docks', () => {
    for (const patch of [
      { status: 'CANCELLED' },
      { status: 'COMPLETED' },
      { status: 'NO_SHOW' },
      { spotId: 'other' },
      { spotId: null },
      { windowStart: a.windowEnd, windowEnd: '2026-09-14T12:00:00Z' },
    ])
      expect(yardAppointmentConflicts([a, { ...a, id: 'b', ...patch }])).toEqual([]);
  });
});
