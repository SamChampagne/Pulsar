import { describe, expect, it } from 'vitest';
import { computeDwell, computeAppointmentTiming, DEFAULT_FREE_DWELL_MINUTES } from './dwell';

const minsAgo = (m: number) => new Date(Date.now() - m * 60_000);

describe('computeDwell', () => {
  it('is IN_YARD early in the free window', () => {
    const r = computeDwell({ checkInAt: minsAgo(30) });
    expect(r.status).toBe('IN_YARD');
    expect(r.detentionMinutes).toBe(0);
    expect(r.minutes).toBeGreaterThanOrEqual(29);
  });

  it('is WARNING near the free window', () => {
    const r = computeDwell({ checkInAt: minsAgo(100) }); // 100 >= 120*0.75
    expect(r.status).toBe('WARNING');
  });

  it('is DETENTION past the free window with accrued minutes', () => {
    const r = computeDwell({ checkInAt: minsAgo(DEFAULT_FREE_DWELL_MINUTES + 45) });
    expect(r.status).toBe('DETENTION');
    expect(r.detentionMinutes).toBeGreaterThanOrEqual(44);
  });

  it('is DEPARTED once checked out (dwell frozen)', () => {
    const r = computeDwell({ checkInAt: minsAgo(200), checkOutAt: minsAgo(20) });
    expect(r.status).toBe('DEPARTED');
    expect(r.minutes).toBe(180);
  });

  it('honours a custom free window', () => {
    const r = computeDwell({ checkInAt: minsAgo(40), freeMinutes: 30 });
    expect(r.status).toBe('DETENTION');
  });
});

describe('computeAppointmentTiming', () => {
  it('is UPCOMING before the window', () => {
    const r = computeAppointmentTiming({
      windowStart: new Date(Date.now() + 3_600_000),
      windowEnd: new Date(Date.now() + 7_200_000),
      status: 'SCHEDULED',
    });
    expect(r.status).toBe('UPCOMING');
  });

  it('is LATE past the window while still SCHEDULED', () => {
    const r = computeAppointmentTiming({
      windowStart: minsAgo(120),
      windowEnd: minsAgo(30),
      status: 'SCHEDULED',
    });
    expect(r.status).toBe('LATE');
    expect(r.minutesLate).toBeGreaterThanOrEqual(29);
  });

  it('is DONE once arrived/completed', () => {
    expect(
      computeAppointmentTiming({
        windowStart: minsAgo(60),
        windowEnd: minsAgo(10),
        status: 'ARRIVED',
      }).status,
    ).toBe('DONE');
  });
});
