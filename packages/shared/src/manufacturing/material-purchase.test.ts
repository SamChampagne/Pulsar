import { describe, expect, it } from 'vitest';
import {
  canTransitionMaterialPurchase as can,
  MaterialPurchaseStatus as S,
} from './material-purchase';
import { materialPurchaseSubtotal } from './material-purchase';
describe('material purchase state machine', () => {
  it('multiplies and rounds exactly, including half cents and large values', () => {
    expect(materialPurchaseSubtotal('5.25', '1.123456')).toBe('5.90');
    expect(materialPurchaseSubtotal('1', '0.005')).toBe('0.01');
    expect(materialPurchaseSubtotal('1', '0.004999')).toBe('0.00');
    expect(materialPurchaseSubtotal('1000000000', '1000000000')).toBe('1000000000000000000.00');
    expect(materialPurchaseSubtotal('999999999.999', '999999999.999999')).toBe(
      '999999999998999000.00',
    );
    expect(() => materialPurchaseSubtotal('1.0001', '1')).toThrow();
  });
  it('confirms or cancels drafts, but never reopens a committed/terminal order', () => {
    expect(can(S.DRAFT, S.CONFIRMED)).toBe(true);
    expect(can(S.DRAFT, S.CANCELLED)).toBe(true);
    expect(can(S.CONFIRMED, S.CANCELLED)).toBe(true);
    expect(can(S.CONFIRMED, S.DRAFT)).toBe(false);
    expect(can(S.CONFIRMED, S.CONFIRMED)).toBe(false);
    expect(can(S.CANCELLED, S.DRAFT)).toBe(false);
    expect(can(S.CANCELLED, S.CONFIRMED)).toBe(false);
  });
});
