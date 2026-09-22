import { describe, expect, it } from 'vitest';
import {
  HrQualificationStatus as S,
  canTransitionHrQualification,
  qualificationDates,
  qualificationState,
} from './hr-skills';
describe('qualifications datées', () => {
  const q = { status: 'ACTIVE', validFrom: '2030-01-10', expiresOn: '2030-01-20' };
  it.each([
    ['2030-01-09', 'UPCOMING'],
    ['2030-01-10', 'VALID'],
    ['2030-01-20', 'VALID'],
    ['2030-01-21', 'EXPIRED'],
  ])('classe %s comme %s', (d, s) => expect(qualificationState(q, d)).toBe(s));
  it('une révocation prime même sur une date passée', () =>
    expect(qualificationState({ ...q, status: 'REVOKED' }, '2029-01-01')).toBe('REVOKED'));
  it('sans fin déclarée ne veut pas dire expirée', () =>
    expect(qualificationState({ ...q, expiresOn: null }, '2035-01-01')).toBe('VALID'));
  it.each([
    ['2030-02-30', null],
    ['2030-02-10', '2030-02-09'],
    ['bad', null],
  ])('refuse la période %s/%s', (a, b) => expect(() => qualificationDates(a!, b)).toThrow());
  it('interdit une réactivation', () => {
    expect(canTransitionHrQualification(S.ACTIVE, S.REVOKED)).toBe(true);
    expect(canTransitionHrQualification(S.REVOKED, S.ACTIVE)).toBe(false);
    expect(canTransitionHrQualification(S.REVOKED, S.REVOKED)).toBe(false);
  });
});
