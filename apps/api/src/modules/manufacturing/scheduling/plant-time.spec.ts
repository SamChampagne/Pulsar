import { plantClock, plantWindows } from './plant-time';

describe('Manufacturing plant-time boundary', () => {
  const week = [{ id: 'c', name: 'Week', shifts: [{ weekday: 0, start: '08:00', end: '17:00' }] }];
  it.each([
    ['America/Toronto', '2026-01-05T13:00:00'],
    ['Europe/Paris', '2026-01-05T07:00:00'],
    ['Asia/Kathmandu', '2026-01-05T02:15:00'],
    ['UTC', '2026-01-05T08:00:00'],
  ])('captures 08:00 local as a UTC instant in %s', (zone, expected) => {
    expect(plantWindows(week, zone, '2026-01-05', 1).calendar_windows.c[0].start).toBe(expected);
  });
  it.each([
    ['2026-03-08', 23],
    ['2026-11-01', 25],
  ])('preserves the real elapsed hours of %s', (date, hours) => {
    const result = plantWindows([], 'America/Toronto', date as string, 1);
    expect(
      (Date.parse(`${result.horizon_end}Z`) - Date.parse(`${result.horizon_start}Z`)) / 3_600_000,
    ).toBe(hours);
  });
  it.each(['2026-03-08T02:30:00', '2026-11-01T01:30:00', '2026-02-30T08:00:00'])(
    'rejects missing, repeated or invalid local timestamp %s',
    (local) => {
      expect(() => plantClock('America/Toronto').instant(local)).toThrow();
    },
  );
  it('handles a shift spanning the spring transition in elapsed minutes', () => {
    const calendar = [
      { id: 'c', name: 'Sunday', shifts: [{ weekday: 6, start: '00:00', end: '08:00' }] },
    ];
    const w = plantWindows(calendar, 'America/Toronto', '2026-03-08', 1).calendar_windows.c[0];
    expect(w).toEqual({ start: '2026-03-08T05:00:00', end: '2026-03-08T12:00:00' });
  });
  it('refuses ambiguous shift endpoints without silently choosing a fold', () => {
    const calendar = [
      { id: 'c', name: 'Sunday', shifts: [{ weekday: 6, start: '01:30', end: '08:00' }] },
    ];
    expect(() => plantWindows(calendar, 'America/Toronto', '2026-11-01', 1)).toThrow('ambiguë');
  });
  it('uses plant today rather than the host date, and explicitly captures closed days', () => {
    const result = plantWindows(
      week,
      'America/Toronto',
      undefined,
      1,
      new Date('2026-01-05T01:00:00Z'),
    );
    expect(result.horizon_start).toBe('2026-01-04T05:00:00');
    expect(result.calendar_windows.c).toEqual([]);
  });
  it('rejects invalid zones, horizons and unsupported overnight shifts', () => {
    expect(() => plantWindows(week, 'Bad/Zone', '2026-01-05', 1)).toThrow();
    expect(() => plantWindows(week, '', '2026-01-05', 1)).toThrow();
    expect(() => plantWindows(week, 'UTC', '2026-01-05', 0)).toThrow();
    expect(() => plantWindows(week, 'UTC', '2026-01-05', 366)).toThrow();
    expect(() =>
      plantWindows(
        [{ ...week[0], shifts: [{ weekday: 0, start: '22:00', end: '06:00' }] }],
        'UTC',
        '2026-01-05',
        1,
      ),
    ).toThrow();
  });
});
