import { describe, expect, it } from 'vitest';
import {
  coversManufacturingPeriod,
  canTransitionMrpPreparation,
  MrpPreparationStatus as S,
} from './definitions';

describe('manufacturing validity and internal request workflow', () => {
  it('preserves unbounded legacy revisions and inclusive bounds', () => {
    expect(coversManufacturingPeriod({}, '2026-01-01', '2026-12-31')).toBe(true);
    expect(
      coversManufacturingPeriod(
        { validFrom: '2026-01-01', validUntil: '2026-12-31' },
        '2026-01-01',
        '2026-12-31',
      ),
    ).toBe(true);
  });
  it('refuses periods outside validity or reversed periods', () => {
    expect(coversManufacturingPeriod({ validFrom: '2026-02-01' }, '2026-01-31', '2026-03-01')).toBe(
      false,
    );
    expect(
      coversManufacturingPeriod({ validUntil: '2026-02-01' }, '2026-02-01', '2026-02-02'),
    ).toBe(false);
    expect(coversManufacturingPeriod({}, '2026-02-02', '2026-02-01')).toBe(false);
  });
  it('only allows cancelling a draft, never reopening it', () => {
    expect(canTransitionMrpPreparation(S.DRAFT, S.CANCELLED)).toBe(true);
    expect(canTransitionMrpPreparation(S.CANCELLED, S.DRAFT)).toBe(false);
    expect(canTransitionMrpPreparation(S.CANCELLED, S.CANCELLED)).toBe(false);
  });
});
