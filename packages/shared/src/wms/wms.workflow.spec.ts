import { describe, expect, it } from 'vitest';
import {
  PickOrderStatus,
  ReceiptStatus,
  applyToBalance,
  canTransitionPickOrder,
  canTransitionReceipt,
  deriveShipmentPickStatus,
} from './wms.workflow';

describe('canTransitionReceipt', () => {
  it('allows DRAFT→POSTED and DRAFT→CANCELLED', () => {
    expect(canTransitionReceipt(ReceiptStatus.DRAFT, ReceiptStatus.POSTED)).toBe(true);
    expect(canTransitionReceipt(ReceiptStatus.DRAFT, ReceiptStatus.CANCELLED)).toBe(true);
  });
  it('is a no-op when from===to', () => {
    expect(canTransitionReceipt(ReceiptStatus.POSTED, ReceiptStatus.POSTED)).toBe(true);
  });
  it('rejects out of POSTED/CANCELLED', () => {
    expect(canTransitionReceipt(ReceiptStatus.POSTED, ReceiptStatus.CANCELLED)).toBe(false);
    expect(canTransitionReceipt(ReceiptStatus.CANCELLED, ReceiptStatus.POSTED)).toBe(false);
  });
});

describe('canTransitionPickOrder', () => {
  it('allows the picking lifecycle', () => {
    expect(canTransitionPickOrder(PickOrderStatus.OPEN, PickOrderStatus.PICKED)).toBe(true);
    expect(canTransitionPickOrder(PickOrderStatus.OPEN, PickOrderStatus.COMPLETED)).toBe(true);
    expect(canTransitionPickOrder(PickOrderStatus.PICKED, PickOrderStatus.COMPLETED)).toBe(true);
    expect(canTransitionPickOrder(PickOrderStatus.OPEN, PickOrderStatus.CANCELLED)).toBe(true);
  });
  it('rejects COMPLETED→anything', () => {
    expect(canTransitionPickOrder(PickOrderStatus.COMPLETED, PickOrderStatus.CANCELLED)).toBe(false);
  });
});

describe('applyToBalance', () => {
  it('adds a positive delta', () => {
    expect(applyToBalance(5, 3)).toEqual({ ok: true, next: 8 });
  });
  it('subtracts when enough on hand', () => {
    expect(applyToBalance(5, -3)).toEqual({ ok: true, next: 2 });
  });
  it('refuses to go negative', () => {
    expect(applyToBalance(2, -5)).toEqual({ ok: false, reason: 'NEGATIVE' });
  });
  it('allows negative only with override', () => {
    expect(applyToBalance(2, -5, { allowNegative: true })).toEqual({ ok: true, next: -3 });
  });
});

describe('deriveShipmentPickStatus', () => {
  it('NOT_PICKED when there are no pick orders', () => {
    expect(deriveShipmentPickStatus([])).toBe('NOT_PICKED');
  });
  it('NOT_PICKED when all linked pick orders are cancelled', () => {
    expect(deriveShipmentPickStatus([PickOrderStatus.CANCELLED, PickOrderStatus.CANCELLED])).toBe('NOT_PICKED');
  });
  it('PICKING when an open/picked order exists and none completed', () => {
    expect(deriveShipmentPickStatus([PickOrderStatus.OPEN])).toBe('PICKING');
    expect(deriveShipmentPickStatus([PickOrderStatus.PICKED, PickOrderStatus.CANCELLED])).toBe('PICKING');
  });
  it('PICKED when at least one linked order is completed', () => {
    expect(deriveShipmentPickStatus([PickOrderStatus.COMPLETED])).toBe('PICKED');
    expect(deriveShipmentPickStatus([PickOrderStatus.OPEN, PickOrderStatus.COMPLETED])).toBe('PICKED');
  });
});
