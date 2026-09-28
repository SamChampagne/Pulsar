import { describe, it, expect } from 'vitest';
import {
  canTransitionLedgerCurrency,
  LedgerCurrencyState as S,
  isHistoricalManualEntry,
  validateLedgerQualification,
} from './ledger-qualification';
describe('Historical journal qualification', () => {
  it('requires withdrawal before a new qualification', () => {
    expect(canTransitionLedgerCurrency(null, S.QUALIFIED)).toBe(true);
    expect(canTransitionLedgerCurrency(null, S.WITHDRAWN)).toBe(false);
    expect(canTransitionLedgerCurrency(S.QUALIFIED, S.QUALIFIED)).toBe(false);
    expect(canTransitionLedgerCurrency(S.QUALIFIED, S.WITHDRAWN)).toBe(true);
    expect(canTransitionLedgerCurrency(S.WITHDRAWN, S.QUALIFIED)).toBe(true);
    expect(canTransitionLedgerCurrency(S.WITHDRAWN, S.WITHDRAWN)).toBe(false);
  });
  it('accepts only unqualified manual or unattributed sources', () => {
    const e = { currency: null, sourceType: null, sourceId: null, sourceKind: null };
    expect(isHistoricalManualEntry(e)).toBe(true);
    expect(
      isHistoricalManualEntry({
        ...e,
        sourceType: 'manual',
        sourceId: 'key',
        sourceKind: 'posted',
      }),
    ).toBe(true);
    for (const c of [
      { currency: 'CAD' },
      { sourceId: 'foreign' },
      { sourceType: 'payment' },
      { sourceType: 'depreciation' },
      { sourceType: 'manual', sourceKind: 'reversal' },
    ])
      expect(isHistoricalManualEntry({ ...e, ...c })).toBe(false);
  });
  it('requires currency, documented reason, evidence and a nonnegative version', () => {
    const d = {
      action: 'QUALIFY',
      currency: 'CAD',
      reason: 'Original reçu vérifié.',
      evidenceId: 'proof-1',
      expectedVersion: 0,
    };
    expect(() => validateLedgerQualification(d)).not.toThrow();
    expect(() =>
      validateLedgerQualification({ ...d, action: 'WITHDRAW', currency: '' }),
    ).not.toThrow();
    for (const change of [
      { currency: '' },
      { currency: 'ZZZ' },
      { action: 'WITHDRAW' },
      { reason: '  ' },
      { expectedVersion: -1 },
      { expectedVersion: 1.2 },
      { evidenceId: '' },
      { action: 'DELETE' },
    ])
      expect(() => validateLedgerQualification({ ...d, ...change })).toThrow();
  });
});
