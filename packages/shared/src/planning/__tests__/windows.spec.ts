import { describe, expect, it } from 'vitest';
import { validateWindowPair, windowViolations } from '../windows';

const d = (s: string) => new Date(s);

describe('validateWindowPair', () => {
  it('accepts early ≤ late and open bounds', () => {
    expect(validateWindowPair({ early: d('2026-07-01'), late: d('2026-07-02') })).toBeNull();
    expect(validateWindowPair({ early: d('2026-07-01'), late: null })).toBeNull();
    expect(validateWindowPair({ early: null, late: d('2026-07-02') })).toBeNull();
    expect(validateWindowPair({ early: null, late: null })).toBeNull();
  });

  it('rejects early > late', () => {
    expect(validateWindowPair({ early: d('2026-07-03'), late: d('2026-07-02') })).toMatch(/early/);
  });
});

describe('windowViolations — planned vs requested', () => {
  const requested = { early: d('2026-07-01T08:00Z'), late: d('2026-07-01T12:00Z') };

  it('no violation when planned inside the requested window', () => {
    expect(
      windowViolations('pickup', requested, { early: d('2026-07-01T09:00Z'), late: d('2026-07-01T11:00Z') }),
    ).toEqual([]);
  });

  it('flags planned starting before requested.early and ending after requested.late', () => {
    const violations = windowViolations('pickup', requested, {
      early: d('2026-07-01T06:00Z'),
      late: d('2026-07-01T14:00Z'),
    });
    expect(violations).toHaveLength(2);
    expect(violations[0]).toEqual({
      field: 'pickup',
      kind: 'BEFORE_EARLY',
      requested: requested.early!.toISOString(),
      planned: d('2026-07-01T06:00Z').toISOString(),
    });
    expect(violations[1].kind).toBe('AFTER_LATE');
  });

  it('open requested bounds constrain nothing on that side', () => {
    expect(
      windowViolations('delivery', { early: null, late: d('2026-07-01T12:00Z') }, { early: d('2026-06-01T00:00Z'), late: d('2026-07-01T10:00Z') }),
    ).toEqual([]);
  });

  it('no violation when planned is entirely absent', () => {
    expect(windowViolations('pickup', requested, { early: null, late: null })).toEqual([]);
  });

  it('a single planned point (late null) is checked against both requested bounds', () => {
    expect(
      windowViolations('pickup', requested, { early: d('2026-07-01T13:00Z'), late: null }),
    ).toEqual([
      {
        field: 'pickup',
        kind: 'AFTER_LATE',
        requested: requested.late!.toISOString(),
        planned: d('2026-07-01T13:00Z').toISOString(),
      },
    ]);
  });
});
