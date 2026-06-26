import { describe, expect, it } from 'vitest';
import { LoadStatus, ShipmentStatus, TransportOrderStatus } from '../../enums/transportation';
import { InvoiceStatus, CustomerInvoiceStatus } from '../../enums/billing';
import { canTransitionLoad, LOAD_TRANSITIONS } from '../load.workflow';
import { canTransitionShipment, SHIPMENT_TRANSITIONS } from '../shipment.workflow';
import {
  canTransitionTransportOrder,
  TRANSPORT_ORDER_TRANSITIONS,
} from '../transport-order.workflow';
import { canTransitionInvoice } from '../invoice.workflow';
import { canTransitionCustomerInvoice } from '../customer-invoice.workflow';

describe('TransportOrder workflow', () => {
  it('follows the happy path DRAFT → … → CLOSED', () => {
    const path = [
      TransportOrderStatus.DRAFT,
      TransportOrderStatus.CONFIRMED,
      TransportOrderStatus.PLANNED,
      TransportOrderStatus.IN_EXECUTION,
      TransportOrderStatus.COMPLETED,
      TransportOrderStatus.CLOSED,
    ];
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransitionTransportOrder(path[i], path[i + 1])).toBe(true);
    }
  });

  it('rejects skipping states', () => {
    expect(canTransitionTransportOrder(TransportOrderStatus.DRAFT, TransportOrderStatus.PLANNED)).toBe(false);
    expect(
      canTransitionTransportOrder(TransportOrderStatus.CONFIRMED, TransportOrderStatus.COMPLETED),
    ).toBe(false);
    expect(canTransitionTransportOrder(TransportOrderStatus.DRAFT, TransportOrderStatus.CLOSED)).toBe(false);
  });

  it('allows cancellation only before execution', () => {
    expect(canTransitionTransportOrder(TransportOrderStatus.DRAFT, TransportOrderStatus.CANCELLED)).toBe(true);
    expect(
      canTransitionTransportOrder(TransportOrderStatus.CONFIRMED, TransportOrderStatus.CANCELLED),
    ).toBe(true);
    expect(canTransitionTransportOrder(TransportOrderStatus.PLANNED, TransportOrderStatus.CANCELLED)).toBe(true);
    expect(
      canTransitionTransportOrder(TransportOrderStatus.IN_EXECUTION, TransportOrderStatus.CANCELLED),
    ).toBe(false);
  });

  it('treats CLOSED and CANCELLED as terminal', () => {
    expect(TRANSPORT_ORDER_TRANSITIONS[TransportOrderStatus.CLOSED]).toEqual([]);
    expect(TRANSPORT_ORDER_TRANSITIONS[TransportOrderStatus.CANCELLED]).toEqual([]);
  });

  it('covers every status in the transition map', () => {
    expect(Object.keys(TRANSPORT_ORDER_TRANSITIONS).sort()).toEqual(
      Object.values(TransportOrderStatus).sort(),
    );
  });
});

describe('Shipment workflow', () => {
  it('follows the happy path PENDING → … → CLOSED', () => {
    const path = [
      ShipmentStatus.PENDING,
      ShipmentStatus.PLANNED,
      ShipmentStatus.DISPATCHED,
      ShipmentStatus.IN_TRANSIT,
      ShipmentStatus.DELIVERED,
      ShipmentStatus.CLOSED,
    ];
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransitionShipment(path[i], path[i + 1])).toBe(true);
    }
  });

  it('allows unplanning a PLANNED shipment back to PENDING', () => {
    expect(canTransitionShipment(ShipmentStatus.PLANNED, ShipmentStatus.PENDING)).toBe(true);
  });

  it('rejects backwards moves once in transit', () => {
    expect(canTransitionShipment(ShipmentStatus.IN_TRANSIT, ShipmentStatus.DISPATCHED)).toBe(false);
    expect(canTransitionShipment(ShipmentStatus.DELIVERED, ShipmentStatus.IN_TRANSIT)).toBe(false);
  });

  it('covers every status in the transition map', () => {
    expect(Object.keys(SHIPMENT_TRANSITIONS).sort()).toEqual(Object.values(ShipmentStatus).sort());
  });
});

describe('Load workflow', () => {
  it('follows the happy path OPEN → … → COMPLETED', () => {
    const path = [
      LoadStatus.OPEN,
      LoadStatus.PLANNED,
      LoadStatus.DISPATCHED,
      LoadStatus.IN_TRANSIT,
      LoadStatus.COMPLETED,
    ];
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransitionLoad(path[i], path[i + 1])).toBe(true);
    }
  });

  it('allows reopening a PLANNED load', () => {
    expect(canTransitionLoad(LoadStatus.PLANNED, LoadStatus.OPEN)).toBe(true);
  });

  it('supports the tender detour: PLANNED → TENDERED → DISPATCHED', () => {
    expect(canTransitionLoad(LoadStatus.PLANNED, LoadStatus.TENDERED)).toBe(true);
    expect(canTransitionLoad(LoadStatus.TENDERED, LoadStatus.DISPATCHED)).toBe(true);
    expect(canTransitionLoad(LoadStatus.TENDERED, LoadStatus.PLANNED)).toBe(true);
  });

  it('rejects tendering an OPEN load or re-tendering after dispatch', () => {
    expect(canTransitionLoad(LoadStatus.OPEN, LoadStatus.TENDERED)).toBe(false);
    expect(canTransitionLoad(LoadStatus.DISPATCHED, LoadStatus.TENDERED)).toBe(false);
  });

  it('rejects cancelling once in transit', () => {
    expect(canTransitionLoad(LoadStatus.IN_TRANSIT, LoadStatus.CANCELLED)).toBe(false);
  });

  it('rejects dispatching an OPEN load directly', () => {
    expect(canTransitionLoad(LoadStatus.OPEN, LoadStatus.DISPATCHED)).toBe(false);
  });

  it('covers every status in the transition map', () => {
    expect(Object.keys(LOAD_TRANSITIONS).sort()).toEqual(Object.values(LoadStatus).sort());
  });
});

describe('invoice workflow', () => {
  it('allows the reconciliation paths', () => {
    expect(canTransitionInvoice(InvoiceStatus.DRAFT, InvoiceStatus.APPROVED)).toBe(true);
    expect(canTransitionInvoice(InvoiceStatus.DRAFT, InvoiceStatus.DISPUTED)).toBe(true);
    expect(canTransitionInvoice(InvoiceStatus.DISPUTED, InvoiceStatus.APPROVED)).toBe(true);
    expect(canTransitionInvoice(InvoiceStatus.APPROVED, InvoiceStatus.PAID)).toBe(true);
  });

  it('allows reverting PAID to APPROVED on payment cancellation', () => {
    expect(canTransitionInvoice(InvoiceStatus.PAID, InvoiceStatus.APPROVED)).toBe(true);
  });

  it('blocks the invalid paths', () => {
    expect(canTransitionInvoice(InvoiceStatus.PAID, InvoiceStatus.DRAFT)).toBe(false);
    expect(canTransitionInvoice(InvoiceStatus.APPROVED, InvoiceStatus.DISPUTED)).toBe(false);
    expect(canTransitionInvoice(InvoiceStatus.DISPUTED, InvoiceStatus.PAID)).toBe(false);
  });
});

describe('customer invoice workflow', () => {
  it('follows DRAFT → APPROVED → SENT → PAID', () => {
    expect(canTransitionCustomerInvoice(CustomerInvoiceStatus.DRAFT, CustomerInvoiceStatus.APPROVED)).toBe(true);
    expect(canTransitionCustomerInvoice(CustomerInvoiceStatus.APPROVED, CustomerInvoiceStatus.SENT)).toBe(true);
    expect(canTransitionCustomerInvoice(CustomerInvoiceStatus.SENT, CustomerInvoiceStatus.PAID)).toBe(true);
  });

  it('allows paying directly from APPROVED (no send required)', () => {
    expect(canTransitionCustomerInvoice(CustomerInvoiceStatus.APPROVED, CustomerInvoiceStatus.PAID)).toBe(true);
  });

  it('allows reverting PAID to SENT or APPROVED on payment cancellation', () => {
    expect(canTransitionCustomerInvoice(CustomerInvoiceStatus.PAID, CustomerInvoiceStatus.SENT)).toBe(true);
    expect(canTransitionCustomerInvoice(CustomerInvoiceStatus.PAID, CustomerInvoiceStatus.APPROVED)).toBe(true);
  });

  it('refuses skips and backward moves', () => {
    expect(canTransitionCustomerInvoice(CustomerInvoiceStatus.DRAFT, CustomerInvoiceStatus.SENT)).toBe(false);
    expect(canTransitionCustomerInvoice(CustomerInvoiceStatus.DRAFT, CustomerInvoiceStatus.PAID)).toBe(false);
    expect(canTransitionCustomerInvoice(CustomerInvoiceStatus.APPROVED, CustomerInvoiceStatus.DRAFT)).toBe(false);
    expect(canTransitionCustomerInvoice(CustomerInvoiceStatus.PAID, CustomerInvoiceStatus.DRAFT)).toBe(false);
  });
});
