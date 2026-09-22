import { describe, expect, it } from 'vitest';
import {
  ServiceQuoteStatus as S,
  canTransitionServiceQuote,
  serviceIntervalsOverlap,
  serviceLocalDateTime,
  serviceLocalToInstant,
} from './service-commerce';
describe('Service commerce and scheduling primitives', () => {
  it('freezes accepted and cancelled quotes', () => {
    expect(canTransitionServiceQuote(S.DRAFT, S.ACCEPTED)).toBe(true);
    expect(canTransitionServiceQuote(S.DRAFT, S.CANCELLED)).toBe(true);
    for (const from of [S.ACCEPTED, S.CANCELLED])
      for (const to of Object.values(S)) expect(canTransitionServiceQuote(from, to)).toBe(false);
  });
  it('allows adjoining intervals, not overlapping intervals', () => {
    expect(serviceIntervalsOverlap(0, 60, 60 * 60000, 60)).toBe(false);
    expect(serviceIntervalsOverlap(0, 60, 59 * 60000, 60)).toBe(true);
  });
  it('uses the company timezone independently of the host', () => {
    expect(serviceLocalToInstant('2026-09-22T09:00', 'America/Toronto')).toBe(
      '2026-09-22T13:00:00.000Z',
    );
    expect(serviceLocalDateTime('2026-09-22T13:00:00Z', 'America/Toronto')).toBe(
      '2026-09-22T09:00',
    );
    expect(serviceLocalToInstant('2026-09-22T09:00', 'Asia/Kathmandu')).toBe(
      '2026-09-22T03:15:00.000Z',
    );
  });
  it('rejects invalid dates, DST gaps and ambiguous folds', () => {
    for (const date of ['2026-02-30T09:00', '2026-03-08T02:30', '2026-11-01T01:30'])
      expect(() => serviceLocalToInstant(date, 'America/Toronto')).toThrow();
  });
});
