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

  it('maps wms.item.below-min to a WMS_REPLENISH task', () => {
    const r = resolvePolicies({
      type: DOMAIN_EVENT_TYPES.WMS_ITEM_BELOW_MIN,
      payload: { itemId: 'it1', sku: 'SKU-1', onHand: 3, suggestedQty: 47 },
    });
    expect(r[0].category).toBe('WMS_REPLENISH');
    expect(r[0].dedupKey).toBe('WMS_REPLENISH:it1');
  });

  it('maps wms.cycle-count.variance to a WMS_COUNT_VARIANCE task', () => {
    const r = resolvePolicies({
      type: DOMAIN_EVENT_TYPES.WMS_CYCLE_COUNT_VARIANCE,
      payload: { cycleCountId: 'cc1', number: 'CC-1', variances: 2 },
    });
    expect(r[0].category).toBe('WMS_COUNT_VARIANCE');
    expect(r[0].dedupKey).toBe('WMS_COUNT_VARIANCE:cc1');
  });

  it('maps yard.visit.detention to a YARD_DETENTION task', () => {
    const r = resolvePolicies({
      type: DOMAIN_EVENT_TYPES.YARD_VISIT_DETENTION,
      payload: { visitId: 'v1', visitNumber: 'YV-1', trailerLabel: 'TRL-2', detentionMinutes: 45 },
    });
    expect(r[0].category).toBe('YARD_DETENTION');
    expect(r[0].dedupKey).toBe('YARD_DETENTION:v1');
  });

  it('maps yard.appointment.late to a YARD_APPOINTMENT_LATE task', () => {
    const r = resolvePolicies({
      type: DOMAIN_EVENT_TYPES.YARD_APPOINTMENT_LATE,
      payload: { appointmentId: 'a1', number: 'DA-1', minutesLate: 30 },
    });
    expect(r[0].category).toBe('YARD_APPOINTMENT_LATE');
    expect(r[0].dedupKey).toBe('YARD_APPT_LATE:a1');
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

describe('driver.exception policy', () => {
  it('maps driver.exception DAMAGE to a CRITICAL DRIVER_EXCEPTION task', () => {
    const specs = resolvePolicies({
      type: DOMAIN_EVENT_TYPES.DRIVER_EXCEPTION,
      payload: {
        loadId: 'l1',
        loadNumber: 'LD-42',
        kind: 'DAMAGE',
        note: 'Front bumper dented',
        bucket: '2026-06-18T14:00',
      },
    });
    expect(specs).toHaveLength(1);
    expect(specs[0].type).toBe(OperationalTaskType.EXCEPTION);
    expect(specs[0].category).toBe('DRIVER_EXCEPTION');
    expect(specs[0].severity).toBe('CRITICAL');
    expect(specs[0].subjectType).toBe('load');
    expect(specs[0].subjectId).toBe('l1');
    expect(specs[0].title).toBe('Exception conducteur — DAMAGE (load LD-42)');
    expect(specs[0].dedupKey).toBe('driver-exception:l1:DAMAGE:2026-06-18T14:00');
    expect(specs[0].assignHint).toBe('AUTO');
  });

  it('maps driver.exception REFUSED to CRITICAL severity', () => {
    const specs = resolvePolicies({
      type: DOMAIN_EVENT_TYPES.DRIVER_EXCEPTION,
      payload: { loadId: 'l2', loadNumber: 'LD-99', kind: 'REFUSED', note: 'Customer absent', bucket: 'b1' },
    });
    expect(specs[0].severity).toBe('CRITICAL');
  });

  it('maps driver.exception DELAY to WARNING severity', () => {
    const specs = resolvePolicies({
      type: DOMAIN_EVENT_TYPES.DRIVER_EXCEPTION,
      payload: { loadId: 'l3', loadNumber: 'LD-7', kind: 'DELAY', note: 'Traffic jam', bucket: 'b2' },
    });
    expect(specs[0].severity).toBe('WARNING');
    expect(specs[0].dedupKey).toBe('driver-exception:l3:DELAY:b2');
  });

  it('maps driver.exception OTHER to WARNING severity', () => {
    const specs = resolvePolicies({
      type: DOMAIN_EVENT_TYPES.DRIVER_EXCEPTION,
      payload: { loadId: 'l4', loadNumber: 'LD-3', kind: 'OTHER', note: 'Weather', bucket: 'b3' },
    });
    expect(specs[0].severity).toBe('WARNING');
  });
});

describe('CRM policies', () => {
  it('maps crm.deal.stale to a CRM_STALE_DEAL task with stable dedupKey', () => {
    const specs = resolvePolicies({
      type: DOMAIN_EVENT_TYPES.CRM_DEAL_STALE,
      payload: { dealId: 'd1', companyId: 'co1', stage: 'PROPOSAL', daysSinceActivity: 10 },
    });
    expect(specs).toHaveLength(1);
    expect(specs[0].type).toBe(OperationalTaskType.EXCEPTION);
    expect(specs[0].category).toBe('CRM_STALE_DEAL');
    expect(specs[0].severity).toBe('WARNING');
    expect(specs[0].subjectType).toBe('deal');
    expect(specs[0].subjectId).toBe('d1');
    expect(specs[0].dedupKey).toBe('CRM_STALE_DEAL:d1');
    expect(specs[0].assignHint).toBe('AUTO');
    expect(specs[0].title).toContain('10');
  });

  it('maps crm.followup.due to a CRM_FOLLOWUP_DUE task with stable dedupKey', () => {
    const specs = resolvePolicies({
      type: DOMAIN_EVENT_TYPES.CRM_FOLLOWUP_DUE,
      payload: { activityId: 'act1', dealId: 'd1', companyId: 'co1', dueAt: '2026-06-15T09:00:00.000Z' },
    });
    expect(specs).toHaveLength(1);
    expect(specs[0].type).toBe(OperationalTaskType.EXCEPTION);
    expect(specs[0].category).toBe('CRM_FOLLOWUP_DUE');
    expect(specs[0].severity).toBe('WARNING');
    expect(specs[0].subjectType).toBe('crm-activity');
    expect(specs[0].subjectId).toBe('act1');
    expect(specs[0].dedupKey).toBe('CRM_FOLLOWUP_DUE:act1');
    expect(specs[0].assignHint).toBe('AUTO');
  });
});

describe('PORTAL_CHANGE_REQUEST policy', () => {
  const orderId = 'to-abc';
  const bucket = '2026-06-18T15:00';

  it('maps portal.change-request with subject transport-order → CHANGE_REQUEST WARNING task', () => {
    const specs = resolvePolicies({
      type: DOMAIN_EVENT_TYPES.PORTAL_CHANGE_REQUEST,
      payload: {
        subject: { type: 'transport-order', id: orderId },
        kind: 'DATE',
        bucket,
        customerName: 'Acme',
        note: 'Please move to next week',
        orderNumber: 'TO-1',
      },
    });
    expect(specs).toHaveLength(1);
    expect(specs[0].type).toBe(OperationalTaskType.EXCEPTION);
    expect(specs[0].category).toBe('CHANGE_REQUEST');
    expect(specs[0].severity).toBe('WARNING');
    expect(specs[0].subjectType).toBe('transport-order');
    expect(specs[0].subjectId).toBe(orderId);
    expect(specs[0].title).toBe('Demande de changement client — DATE');
    expect(specs[0].title).toContain('DATE');
    expect(specs[0].dedupKey).toBe(`portal-change:${orderId}:DATE:${bucket}`);
    expect(specs[0].assignHint).toBe('UNASSIGNED');
  });

  it('maps portal.change-request with subject shipment → correct subjectType and subjectId', () => {
    const shipmentId = 'sh-xyz';
    const specs = resolvePolicies({
      type: DOMAIN_EVENT_TYPES.PORTAL_CHANGE_REQUEST,
      payload: {
        subject: { type: 'shipment', id: shipmentId },
        kind: 'ADDRESS',
        bucket,
        customerName: 'Acme',
        note: 'New delivery address',
      },
    });
    expect(specs).toHaveLength(1);
    expect(specs[0].subjectType).toBe('shipment');
    expect(specs[0].subjectId).toBe(shipmentId);
    expect(specs[0].dedupKey).toBe(`portal-change:${shipmentId}:ADDRESS:${bucket}`);
  });

  it('returns stable dedupKey — same subject+kind+bucket always yields the same key', () => {
    const makeSpecs = () =>
      resolvePolicies({
        type: DOMAIN_EVENT_TYPES.PORTAL_CHANGE_REQUEST,
        payload: {
          subject: { type: 'transport-order', id: orderId },
          kind: 'CANCEL',
          bucket,
          customerName: 'Acme',
          note: 'Client changed their mind',
        },
      });
    expect(makeSpecs()[0].dedupKey).toBe(makeSpecs()[0].dedupKey);
    expect(makeSpecs()[0].dedupKey).toBe(`portal-change:${orderId}:CANCEL:${bucket}`);
  });
});
