import { describe, it, expect, beforeEach } from 'vitest';
import {
  readQualificationIntent,
  rememberQualificationIntent,
  validateQualificationIntent,
  type QualificationIntent,
} from './qualification-intent';
const p = (): QualificationIntent => ({
  entryId: 'entry-1',
  body: {
    action: 'QUALIFY',
    currency: 'CAD',
    reason: 'Justificatif vérifié',
    expectedVersion: 0,
    evidenceId: 'proof-1',
    operationKey: '11111111-1111-4111-8111-111111111111',
    reviewToken: 'a'.repeat(64),
    confirmed: true,
  },
});
describe('qualification intent', () => {
  beforeEach(() => localStorage.clear());
  it('preserves exact requests through reload', () => {
    expect(readQualificationIntent('k')).toBeNull();
    rememberQualificationIntent('k', p());
    expect(readQualificationIntent('k')).toEqual(p());
    rememberQualificationIntent('k', p());
    expect(() => rememberQualificationIntent('k', { ...p(), entryId: 'entry-2' })).toThrow();
  });
  it('rejects corrupt/extra fields and unconfirmed requests', () => {
    for (const change of [
      { confirmed: false },
      { operationKey: 'zzzzzzzz-1111-4111-8111-111111111111' },
      { currency: '' },
      { reviewToken: 'x' },
      { reason: 'short' },
      { tenantId: 'other' },
    ])
      expect(() =>
        validateQualificationIntent({
          ...p(),
          body: { ...p().body, ...change },
        } as QualificationIntent),
      ).toThrow();
    localStorage.setItem('k', '{}');
    expect(() => readQualificationIntent('k')).toThrow();
  });
});
