import { describe, it, expect } from 'vitest';
import { HrLeaveStatus as S, canTransitionHrLeave, hrLeaveDates } from './hr';
import { isCalendarDate } from './calendar-date';
describe('RH civil dates and workflow', () => {
  it('checks real calendar dates, bounds and leap years', () => {
    for (const value of [
      '2026-02-29',
      '2026-04-31',
      '2026-13-01',
      '26-01-01',
      '2026-1-1',
      '1899-12-31',
      '2200-01-01',
      '',
      null,
      0,
    ])
      expect(isCalendarDate(value)).toBe(false);
    expect(isCalendarDate('2028-02-29')).toBe(true);
    expect(isCalendarDate('2026-09-22')).toBe(true);
  });
  it('treats a single civil date as a valid period but never computes payroll days', () => {
    const result = hrLeaveDates('2026-09-22', '2026-09-22');
    expect(result.startDate).toEqual(result.endDate);
    expect(() => hrLeaveDates('2026-09-23', '2026-09-22')).toThrow();
    expect(() => hrLeaveDates('2026-01-01', '2027-01-02')).toThrow();
    expect(() => hrLeaveDates('2026-02-30', '2026-03-01')).toThrow();
  });
  it('has no direct approval of drafts and makes cancellation terminal', () => {
    expect(canTransitionHrLeave(S.DRAFT, S.SUBMITTED)).toBe(true);
    expect(canTransitionHrLeave(S.DRAFT, S.APPROVED)).toBe(false);
    expect(canTransitionHrLeave(S.SUBMITTED, S.APPROVED)).toBe(true);
    expect(canTransitionHrLeave(S.REJECTED, S.DRAFT)).toBe(true);
    expect(canTransitionHrLeave(S.APPROVED, S.DRAFT)).toBe(false);
    for (const to of Object.values(S)) expect(canTransitionHrLeave(S.CANCELLED, to)).toBe(false);
  });
});
