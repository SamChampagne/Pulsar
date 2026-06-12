import { isLate } from './delay-detection.service';

describe('isLate', () => {
  const now = new Date('2026-07-01T12:00:00Z');
  it('on time when the deadline is in the future', () => {
    expect(isLate({ plannedArrivalEarly: null, plannedArrivalLate: new Date('2026-07-01T13:00Z'), actualArrivalAt: null }, now))
      .toEqual({ late: false, deadline: new Date('2026-07-01T13:00Z') });
  });
  it('late past plannedArrivalLate', () => {
    expect(isLate({ plannedArrivalEarly: new Date('2026-07-01T08:00Z'), plannedArrivalLate: new Date('2026-07-01T11:00Z'), actualArrivalAt: null }, now).late).toBe(true);
  });
  it('falls back to plannedArrivalEarly when Late is open', () => {
    const r = isLate({ plannedArrivalEarly: new Date('2026-07-01T11:00Z'), plannedArrivalLate: null, actualArrivalAt: null }, now);
    expect(r).toEqual({ late: true, deadline: new Date('2026-07-01T11:00Z') });
  });
  it('never late once arrived, and never late without any bound', () => {
    expect(isLate({ plannedArrivalEarly: new Date('2026-07-01T08:00Z'), plannedArrivalLate: new Date('2026-07-01T11:00Z'), actualArrivalAt: new Date('2026-07-01T10:00Z') }, now).late).toBe(false);
    expect(isLate({ plannedArrivalEarly: null, plannedArrivalLate: null, actualArrivalAt: null }, now)).toEqual({ late: false, deadline: null });
  });
});
