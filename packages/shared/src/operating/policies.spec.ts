import { describe, expect, it } from 'vitest';
import { OperationalTaskType } from '../enums/operating';
import { resolvePolicies, DOMAIN_EVENT_TYPES, type DomainEventInput } from './policies';

const delayed: DomainEventInput = {
  type: 'stop.delayed',
  payload: { stopId: 's1', loadId: 'l1', deadline: '2026-06-14T12:00:00.000Z', minutesLate: 45 },
};

describe('resolvePolicies', () => {
  it('turns stop.delayed into one EXCEPTION/DELAY task with a stable dedupKey', () => {
    const specs = resolvePolicies(delayed);
    expect(specs).toHaveLength(1);
    expect(specs[0].type).toBe(OperationalTaskType.EXCEPTION);
    expect(specs[0].category).toBe('DELAY');
    expect(specs[0].subjectType).toBe('stop');
    expect(specs[0].subjectId).toBe('s1');
    expect(specs[0].dedupKey).toBe('DELAY:s1:2026-06-14T12:00:00.000Z');
    expect(specs[0].assignHint).toBe('AUTO');
  });

  it('escalates severity to CRITICAL when more than 60 minutes late', () => {
    const specs = resolvePolicies({ ...delayed, payload: { ...delayed.payload, minutesLate: 90 } });
    expect(specs[0].severity).toBe('CRITICAL');
  });

  it('turns tender.declined and tender.expired into TENDER_FAILURE tasks', () => {
    const declined = resolvePolicies({
      type: 'tender.declined',
      payload: { loadId: 'l1', loadNumber: 'LD-1', carrierId: 'c1', tenderId: 't1' },
    });
    expect(declined[0].category).toBe('TENDER_FAILURE');
    expect(declined[0].dedupKey).toBe('TENDER_FAILURE:t1');
  });

  it('marks tender.expired with reason "expired"', () => {
    const expired = resolvePolicies({
      type: 'tender.expired',
      payload: { loadId: 'l1', loadNumber: 'LD-1', carrierId: 'c1', tenderId: 't9' },
    });
    expect(expired).toHaveLength(1);
    expect(expired[0].category).toBe('TENDER_FAILURE');
    expect(expired[0].dedupKey).toBe('TENDER_FAILURE:t9');
    expect(expired[0].details.reason).toBe('expired');
  });

  it('returns [] for an event with no matching policy', () => {
    expect(resolvePolicies({ type: 'load.completed', payload: {} })).toEqual([]);
  });
});

describe('FREIGHT_AUDIT policy', () => {
  it('maps carrier-invoice.received to a FREIGHT_AUDIT task (AUTO)', () => {
    const specs = resolvePolicies({
      type: DOMAIN_EVENT_TYPES.CARRIER_INVOICE_RECEIVED,
      payload: { invoiceId: 'inv1', carrierId: 'c1' },
    });
    expect(specs).toHaveLength(1);
    expect(specs[0].category).toBe('FREIGHT_AUDIT');
    expect(specs[0].subjectType).toBe('incoming-carrier-invoice');
    expect(specs[0].subjectId).toBe('inv1');
    expect(specs[0].dedupKey).toBe('FREIGHT_AUDIT:inv1');
    expect(specs[0].assignHint).toBe('AUTO');
  });
});

describe('cross-module policies', () => {
  it('maps fleet.asset.maintenance to a FLEET_MAINTENANCE task, one per work order', () => {
    const specs = resolvePolicies({
      type: DOMAIN_EVENT_TYPES.FLEET_ASSET_MAINTENANCE,
      payload: { assetKind: 'trailer', assetId: 'a1', unitNumber: 'TRL-7', woId: 'wo1' },
    });
    expect(specs).toHaveLength(1);
    expect(specs[0].category).toBe('FLEET_MAINTENANCE');
    expect(specs[0].subjectType).toBe('trailer');
    expect(specs[0].subjectId).toBe('a1');
    expect(specs[0].dedupKey).toBe('FLEET_MAINTENANCE:wo1');
    expect(specs[0].title).toContain('TRL-7');
    expect(specs[0].severity).toBe('WARNING');
  });

  it('maps wms.pick.completed to a FULFILLMENT_READY task only when tied to a shipment', () => {
    const linked = resolvePolicies({
      type: DOMAIN_EVENT_TYPES.WMS_PICK_COMPLETED,
      payload: { shipmentId: 'sh1', shipmentNumber: 'SH-1', pickOrderId: 'pk1' },
    });
    expect(linked).toHaveLength(1);
    expect(linked[0].category).toBe('FULFILLMENT_READY');
    expect(linked[0].subjectId).toBe('sh1');
    expect(linked[0].dedupKey).toBe('FULFILLMENT_READY:pk1');

    const unlinked = resolvePolicies({
      type: DOMAIN_EVENT_TYPES.WMS_PICK_COMPLETED,
      payload: { pickOrderId: 'pk2' },
    });
    expect(unlinked).toEqual([]);
  });

  it('maps fleet.maintenance.due to a FLEET_PM_DUE task, CRITICAL when overdue', () => {
    const due = resolvePolicies({
      type: DOMAIN_EVENT_TYPES.FLEET_MAINTENANCE_DUE,
      payload: {
        scheduleId: 'sc1',
        name: 'Vidange',
        assetLabel: 'TRK-1',
        status: 'DUE',
        cycle: 'c1',
      },
    });
    expect(due[0].category).toBe('FLEET_PM_DUE');
    expect(due[0].severity).toBe('WARNING');
    expect(due[0].dedupKey).toBe('FLEET_PM_DUE:sc1:c1');

    const overdue = resolvePolicies({
      type: DOMAIN_EVENT_TYPES.FLEET_MAINTENANCE_DUE,
      payload: {
        scheduleId: 'sc1',
        name: 'Vidange',
        assetLabel: 'TRK-1',
        status: 'OVERDUE',
        cycle: 'c2',
      },
    });
    expect(overdue[0].severity).toBe('CRITICAL');
  });

  it('maps yard.visit.checked-in to a YARD_ARRIVAL task', () => {
    const specs = resolvePolicies({
      type: DOMAIN_EVENT_TYPES.YARD_VISIT_CHECKED_IN,
      payload: { visitId: 'v1', visitNumber: 'YV-1', trailerLabel: 'TRL-9' },
    });
    expect(specs).toHaveLength(1);
    expect(specs[0].category).toBe('YARD_ARRIVAL');
    expect(specs[0].subjectType).toBe('yard-visit');
    expect(specs[0].dedupKey).toBe('YARD_ARRIVAL:v1');
    expect(specs[0].title).toContain('TRL-9');
  });
});
