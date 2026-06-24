import { describe, it, expect } from 'vitest';
import { SalesOrderStatus, canTransitionSalesOrder, isSalesOrderOpen } from './sales-order.workflow';

describe('canTransitionSalesOrder', () => {
  it('DRAFT → CONFIRMED / CANCELLED', () => {
    expect(canTransitionSalesOrder(SalesOrderStatus.DRAFT, SalesOrderStatus.CONFIRMED)).toBe(true);
    expect(canTransitionSalesOrder(SalesOrderStatus.DRAFT, SalesOrderStatus.CANCELLED)).toBe(true);
    expect(canTransitionSalesOrder(SalesOrderStatus.DRAFT, SalesOrderStatus.FULFILLED)).toBe(false);
  });
  it('CONFIRMED → FULFILLED / CANCELLED', () => {
    expect(canTransitionSalesOrder(SalesOrderStatus.CONFIRMED, SalesOrderStatus.FULFILLED)).toBe(true);
    expect(canTransitionSalesOrder(SalesOrderStatus.CONFIRMED, SalesOrderStatus.CANCELLED)).toBe(true);
  });
  it('FULFILLED → INVOICED only', () => {
    expect(canTransitionSalesOrder(SalesOrderStatus.FULFILLED, SalesOrderStatus.INVOICED)).toBe(true);
    expect(canTransitionSalesOrder(SalesOrderStatus.FULFILLED, SalesOrderStatus.CANCELLED)).toBe(false);
  });
  it('terminal states never transition out', () => {
    for (const to of Object.values(SalesOrderStatus)) {
      expect(canTransitionSalesOrder(SalesOrderStatus.INVOICED, to)).toBe(false);
      expect(canTransitionSalesOrder(SalesOrderStatus.CANCELLED, to)).toBe(false);
    }
  });
});

describe('isSalesOrderOpen', () => {
  it('open for DRAFT/CONFIRMED/FULFILLED, closed for INVOICED/CANCELLED', () => {
    expect(isSalesOrderOpen(SalesOrderStatus.DRAFT)).toBe(true);
    expect(isSalesOrderOpen(SalesOrderStatus.FULFILLED)).toBe(true);
    expect(isSalesOrderOpen(SalesOrderStatus.INVOICED)).toBe(false);
    expect(isSalesOrderOpen(SalesOrderStatus.CANCELLED)).toBe(false);
  });
});
