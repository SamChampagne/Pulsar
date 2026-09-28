import { describe, expect, it } from 'vitest';
import {
  deriveSupplierReturnBalance as balance,
  supplierReturnDecreased as decreased,
} from './supplier-return-report';
describe('supplier return statements', () => {
  it('keeps exact partial balances', () => {
    expect(balance('5.125', { received: '3.001', accepted: '1.100', refused: '0.101' })).toEqual({
      awaitingReceipt: '2.124',
      awaitingDecision: '1.8',
    });
    expect(balance('10', { received: '10', accepted: '0', refused: '10' })).toEqual({
      awaitingReceipt: '0',
      awaitingDecision: '0',
    });
  });
  it('supports large quantities without binary rounding', () => {
    expect(
      balance('999999999.999', {
        received: '999999999.998',
        accepted: '999999999.997',
        refused: '0.001',
      }),
    ).toEqual({ awaitingReceipt: '0.001', awaitingDecision: '0' });
  });
  it.each(['-1', '1e2', '1.1234', '1000000000', 'NaN', '', ' 1'])(
    'rejects malformed amount %s',
    (v) => {
      expect(() => balance('10', { received: v, accepted: '0', refused: '0' })).toThrow();
    },
  );
  it('refuses over-receipt and over-decision', () => {
    expect(() => balance('2', { received: '3', accepted: '0', refused: '0' })).toThrow();
    expect(() => balance('2', { received: '1', accepted: '0.8', refused: '0.3' })).toThrow();
  });
  it('requires a correction when any previous cumulative total is reduced', () => {
    const p = { received: '2', accepted: '1', refused: '0' };
    expect(decreased(p, { received: '3', accepted: '0.5', refused: '1' })).toBe(true);
    expect(decreased(p, { received: '2.000', accepted: '1', refused: '0' })).toBe(false);
  });
});
