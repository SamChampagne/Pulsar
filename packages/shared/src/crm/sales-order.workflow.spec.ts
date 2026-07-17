import { describe, it, expect } from 'vitest';
import {
  SalesOrderStatus,
  canTransitionSalesOrder,
  isSalesOrderOpen,
  deriveSalesOrderFulfillment,
} from './sales-order.workflow';

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

describe('deriveSalesOrderFulfillment', () => {
  it('no transport orders → not fulfilled', () => {
    expect(deriveSalesOrderFulfillment([])).toEqual({ fulfill: false, reason: 'no-transport-orders' });
  });
  it('any active transport order → not fulfilled (blocks)', () => {
    expect(deriveSalesOrderFulfillment(['COMPLETED', 'IN_EXECUTION'])).toEqual({ fulfill: false, reason: 'active-remaining' });
    expect(deriveSalesOrderFulfillment(['PLANNED'])).toEqual({ fulfill: false, reason: 'active-remaining' });
    expect(deriveSalesOrderFulfillment(['DRAFT', 'CONFIRMED'])).toEqual({ fulfill: false, reason: 'active-remaining' });
  });
  it('all cancelled, none delivered → not fulfilled', () => {
    expect(deriveSalesOrderFulfillment(['CANCELLED'])).toEqual({ fulfill: false, reason: 'all-cancelled' });
    expect(deriveSalesOrderFulfillment(['CANCELLED', 'CANCELLED'])).toEqual({ fulfill: false, reason: 'all-cancelled' });
  });
  it('every order terminal with at least one delivered → fulfilled', () => {
    expect(deriveSalesOrderFulfillment(['COMPLETED'])).toEqual({ fulfill: true, reason: 'all-delivered' });
    expect(deriveSalesOrderFulfillment(['CLOSED'])).toEqual({ fulfill: true, reason: 'all-delivered' });
    // A cancelled sibling does not block once the rest are delivered.
    expect(deriveSalesOrderFulfillment(['COMPLETED', 'CANCELLED'])).toEqual({ fulfill: true, reason: 'all-delivered' });
    expect(deriveSalesOrderFulfillment(['CLOSED', 'COMPLETED'])).toEqual({ fulfill: true, reason: 'all-delivered' });
  });
});
