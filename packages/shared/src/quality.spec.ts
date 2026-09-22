import { describe, it, expect } from 'vitest';
import {
  validateQualityCriteria,
  evaluateQualityResults,
  canTransitionQualityInspection,
  canTransitionQualityNonconformity,
  QualityInspectionStatus as I,
  QualityNonconformityStatus as N,
} from './quality';
const criteria = validateQualityCriteria([
  { key: 'aspect', label: 'Aspect', kind: 'CHECK' },
  { key: 'length', label: 'Longueur', kind: 'NUMBER', unit: 'mm', min: 9.8, max: 10.2 },
]);
describe('Quality contracts', () => {
  it('enforces both terminal workflows', () => {
    expect(canTransitionQualityInspection(I.DRAFT, I.COMPLETED)).toBe(false);
    expect(canTransitionQualityInspection(I.IN_PROGRESS, I.COMPLETED)).toBe(true);
    expect(canTransitionQualityInspection(I.COMPLETED, I.IN_PROGRESS)).toBe(false);
    expect(canTransitionQualityNonconformity(N.OPEN, N.CLOSED)).toBe(false);
    expect(canTransitionQualityNonconformity(N.RESOLVED, N.IN_PROGRESS)).toBe(true);
    expect(canTransitionQualityNonconformity(N.CLOSED, N.IN_PROGRESS)).toBe(false);
  });
  it('requires explicit unique typed criteria and valid bounds', () => {
    for (const value of [
      [],
      [criteria[0], criteria[0]],
      [{ ...criteria[1], min: 11 }],
      [{ ...criteria[0], unit: 'EA' }],
      [{ ...criteria[1], min: NaN }],
      [{ ...criteria[0], extra: true }],
    ])
      expect(() => validateQualityCriteria(value)).toThrow();
  });
  it('does not treat missing, zero or an out-of-range result as a pass', () => {
    expect(evaluateQualityResults(criteria, []).outcome).toBeNull();
    expect(() => evaluateQualityResults(criteria, [], true)).toThrow();
    expect(
      evaluateQualityResults(
        criteria,
        [
          { key: 'aspect', value: 'PASS' },
          { key: 'length', value: 0 },
        ],
        true,
      ),
    ).toMatchObject({ outcome: 'FAIL', failed: 1, missing: 0 });
  });
  it.each([9.8, 10.2])('includes numeric boundary %s', (value) => {
    expect(
      evaluateQualityResults(
        criteria,
        [
          { key: 'aspect', value: 'PASS' },
          { key: 'length', value },
        ],
        true,
      ).outcome,
    ).toBe('PASS');
  });
  it('rejects unknown keys, duplicates, nonfinite and wrongly typed values', () => {
    expect(() => evaluateQualityResults(criteria, [{ key: 'aspect', value: ['PASS'] }])).toThrow();
    for (const values of [
      [{ key: 'unknown', value: 1 }],
      [{ key: 'aspect', value: true }],
      [{ key: 'length', value: '10' }],
      [{ key: 'length', value: Infinity }],
      [
        { key: 'aspect', value: 'PASS' },
        { key: 'aspect', value: 'FAIL' },
      ],
    ])
      expect(() => evaluateQualityResults(criteria, values)).toThrow();
  });
});
