import { OperationalTaskType } from '../enums/operating';

/** Domain-event type catalog (phase 12). Free strings, like webhook event names. */
export const DOMAIN_EVENT_TYPES = {
  STOP_DELAYED: 'stop.delayed',
  TENDER_DECLINED: 'tender.declined',
  TENDER_EXPIRED: 'tender.expired',
  CARRIER_INVOICE_RECEIVED: 'carrier-invoice.received',
  // Cross-module spine: business modules speak to the operating workbench.
  FLEET_ASSET_MAINTENANCE: 'fleet.asset.maintenance',
  FLEET_MAINTENANCE_DUE: 'fleet.maintenance.due',
  WMS_PICK_COMPLETED: 'wms.pick.completed',
  WMS_ITEM_BELOW_MIN: 'wms.item.below-min',
  WMS_CYCLE_COUNT_VARIANCE: 'wms.cycle-count.variance',
  YARD_VISIT_CHECKED_IN: 'yard.visit.checked-in',
  YARD_VISIT_DETENTION: 'yard.visit.detention',
  YARD_APPOINTMENT_LATE: 'yard.appointment.late',
} as const;

export interface DomainEventInput {
  type: string;
  payload: Record<string, unknown>;
}

export type Severity = 'INFO' | 'WARNING' | 'CRITICAL';
export type AssignHint = 'AUTO' | 'UNASSIGNED';

export interface TaskSpec {
  type: OperationalTaskType;
  category: string;
  severity: Severity;
  title: string;
  subjectType: string;
  subjectId: string;
  /** Stable per logical exception — used for idempotent dedup (tenantId, dedupKey). */
  dedupKey: string;
  details: Record<string, unknown>;
  /** AUTO = route to a handling always-on agent if one exists; else fall back to UNASSIGNED. */
  assignHint: AssignHint;
}

interface Policy {
  eventType: string;
  produce(event: DomainEventInput): TaskSpec[];
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' ? v : 0);

/** A delayed stop escalates to CRITICAL severity beyond this many minutes late. */
const DELAY_CRITICAL_MINUTES = 60;

const POLICIES: Policy[] = [
  {
    eventType: DOMAIN_EVENT_TYPES.STOP_DELAYED,
    produce: (e) => {
      const stopId = str(e.payload.stopId);
      const deadline = str(e.payload.deadline);
      const minutesLate = num(e.payload.minutesLate);
      return [
        {
          type: OperationalTaskType.EXCEPTION,
          category: 'DELAY',
          severity: minutesLate > DELAY_CRITICAL_MINUTES ? 'CRITICAL' : 'WARNING',
          title: `Stop ${minutesLate} min late`,
          subjectType: 'stop',
          subjectId: stopId,
          dedupKey: `DELAY:${stopId}:${deadline}`,
          details: { ...e.payload },
          assignHint: 'AUTO',
        },
      ];
    },
  },
  {
    eventType: DOMAIN_EVENT_TYPES.CARRIER_INVOICE_RECEIVED,
    produce: (e) => {
      const invoiceId = str(e.payload.invoiceId);
      return [
        {
          type: OperationalTaskType.EXCEPTION,
          category: 'FREIGHT_AUDIT',
          severity: 'WARNING' as const,
          title: 'Carrier invoice received — audit required',
          subjectType: 'incoming-carrier-invoice',
          subjectId: invoiceId,
          dedupKey: `FREIGHT_AUDIT:${invoiceId}`,
          details: { ...e.payload },
          assignHint: 'AUTO' as const,
        },
      ];
    },
  },
  {
    // Fleet → Dispatch: an asset entering maintenance leaves the dispatchable pool.
    eventType: DOMAIN_EVENT_TYPES.FLEET_ASSET_MAINTENANCE,
    produce: (e) => {
      const assetKind = str(e.payload.assetKind) || 'asset';
      const assetId = str(e.payload.assetId);
      const unit = str(e.payload.unitNumber);
      const woId = str(e.payload.woId);
      const label = unit || assetId;
      return [
        {
          type: OperationalTaskType.EXCEPTION,
          category: 'FLEET_MAINTENANCE',
          severity: 'WARNING' as const,
          title: `${assetKind === 'trailer' ? 'Remorque' : 'Véhicule'} ${label} en maintenance — vérifier l'impact dispatch`,
          subjectType: assetKind,
          subjectId: assetId,
          // One task per work order opening.
          dedupKey: `FLEET_MAINTENANCE:${woId}`,
          details: { ...e.payload },
          assignHint: 'AUTO' as const,
        },
      ];
    },
  },
  {
    // Fleet continuity: a preventive-maintenance schedule reached its due/overdue point.
    eventType: DOMAIN_EVENT_TYPES.FLEET_MAINTENANCE_DUE,
    produce: (e) => {
      const scheduleId = str(e.payload.scheduleId);
      const cycle = str(e.payload.cycle); // stable per due cycle → one task per cycle
      const label = str(e.payload.assetLabel) || str(e.payload.assetId);
      const name = str(e.payload.name) || 'entretien préventif';
      const overdue = str(e.payload.status) === 'OVERDUE';
      return [
        {
          type: OperationalTaskType.EXCEPTION,
          category: 'FLEET_PM_DUE',
          severity: overdue ? ('CRITICAL' as const) : ('WARNING' as const),
          title: `Entretien ${overdue ? 'en retard' : 'dû'} — ${name} (${label})`,
          subjectType: 'maintenance-schedule',
          subjectId: scheduleId,
          dedupKey: `FLEET_PM_DUE:${scheduleId}:${cycle}`,
          details: { ...e.payload },
          assignHint: 'AUTO' as const,
        },
      ];
    },
  },
  {
    // WMS → TMS: a pick order linked to a shipment is completed → freight is ready to ship.
    eventType: DOMAIN_EVENT_TYPES.WMS_PICK_COMPLETED,
    produce: (e) => {
      const shipmentId = str(e.payload.shipmentId);
      const shipmentNumber = str(e.payload.shipmentNumber);
      const pickOrderId = str(e.payload.pickOrderId);
      // Only cross-module when the pick is tied to a shipment.
      if (!shipmentId) return [];
      return [
        {
          type: OperationalTaskType.EXCEPTION,
          category: 'FULFILLMENT_READY',
          severity: 'INFO' as const,
          title: `Shipment ${shipmentNumber || shipmentId} préparé — prêt à expédier`,
          subjectType: 'shipment',
          subjectId: shipmentId,
          dedupKey: `FULFILLMENT_READY:${pickOrderId}`,
          details: { ...e.payload },
          assignHint: 'AUTO' as const,
        },
      ];
    },
  },
  {
    // WMS continuity: an item dropped at/below its reorder point — restock needed.
    eventType: DOMAIN_EVENT_TYPES.WMS_ITEM_BELOW_MIN,
    produce: (e) => {
      const itemId = str(e.payload.itemId);
      const sku = str(e.payload.sku);
      const onHand = num(e.payload.onHand);
      const suggestedQty = num(e.payload.suggestedQty);
      return [
        {
          type: OperationalTaskType.EXCEPTION,
          category: 'WMS_REPLENISH',
          severity: 'WARNING' as const,
          title: `Réappro — ${sku || itemId} (stock ${onHand}${suggestedQty ? `, commander ~${suggestedQty}` : ''})`,
          subjectType: 'wms-item',
          subjectId: itemId,
          dedupKey: `WMS_REPLENISH:${itemId}`,
          details: { ...e.payload },
          assignHint: 'AUTO' as const,
        },
      ];
    },
  },
  {
    // WMS continuity: a reconciled cycle count found stock discrepancies.
    eventType: DOMAIN_EVENT_TYPES.WMS_CYCLE_COUNT_VARIANCE,
    produce: (e) => {
      const cycleCountId = str(e.payload.cycleCountId);
      const number = str(e.payload.number);
      const variances = num(e.payload.variances);
      return [
        {
          type: OperationalTaskType.EXCEPTION,
          category: 'WMS_COUNT_VARIANCE',
          severity: 'WARNING' as const,
          title: `Écart d'inventaire — comptage ${number || cycleCountId} (${variances} ligne(s))`,
          subjectType: 'wms-cycle-count',
          subjectId: cycleCountId,
          dedupKey: `WMS_COUNT_VARIANCE:${cycleCountId}`,
          details: { ...e.payload },
          assignHint: 'AUTO' as const,
        },
      ];
    },
  },
  {
    // Yard → Dispatch: a trailer/carrier checking in at the gate is operational context.
    eventType: DOMAIN_EVENT_TYPES.YARD_VISIT_CHECKED_IN,
    produce: (e) => {
      const visitId = str(e.payload.visitId);
      const visitNumber = str(e.payload.visitNumber);
      const trailer = str(e.payload.trailerLabel);
      return [
        {
          type: OperationalTaskType.EXCEPTION,
          category: 'YARD_ARRIVAL',
          severity: 'INFO' as const,
          title: `Arrivée cour ${visitNumber || visitId}${trailer ? ` — ${trailer}` : ''}`,
          subjectType: 'yard-visit',
          subjectId: visitId,
          dedupKey: `YARD_ARRIVAL:${visitId}`,
          details: { ...e.payload },
          assignHint: 'AUTO' as const,
        },
      ];
    },
  },
  {
    // Yard continuity: a trailer overstayed its free dwell window — detention accrues.
    eventType: DOMAIN_EVENT_TYPES.YARD_VISIT_DETENTION,
    produce: (e) => {
      const visitId = str(e.payload.visitId);
      const visitNumber = str(e.payload.visitNumber);
      const trailer = str(e.payload.trailerLabel);
      const detentionMinutes = num(e.payload.detentionMinutes);
      return [
        {
          type: OperationalTaskType.EXCEPTION,
          category: 'YARD_DETENTION',
          severity: 'WARNING' as const,
          title: `Détention — ${visitNumber || visitId}${trailer ? ` (${trailer})` : ''} +${detentionMinutes} min`,
          subjectType: 'yard-visit',
          subjectId: visitId,
          dedupKey: `YARD_DETENTION:${visitId}`,
          details: { ...e.payload },
          assignHint: 'AUTO' as const,
        },
      ];
    },
  },
  {
    // Yard continuity: a scheduled dock appointment is past its window and unfulfilled.
    eventType: DOMAIN_EVENT_TYPES.YARD_APPOINTMENT_LATE,
    produce: (e) => {
      const appointmentId = str(e.payload.appointmentId);
      const number = str(e.payload.number);
      const minutesLate = num(e.payload.minutesLate);
      return [
        {
          type: OperationalTaskType.EXCEPTION,
          category: 'YARD_APPOINTMENT_LATE',
          severity: 'WARNING' as const,
          title: `Rendez-vous en retard — ${number || appointmentId} (+${minutesLate} min)`,
          subjectType: 'dock-appointment',
          subjectId: appointmentId,
          dedupKey: `YARD_APPT_LATE:${appointmentId}`,
          details: { ...e.payload },
          assignHint: 'AUTO' as const,
        },
      ];
    },
  },
  ...[DOMAIN_EVENT_TYPES.TENDER_DECLINED, DOMAIN_EVENT_TYPES.TENDER_EXPIRED].map(
    (eventType): Policy => ({
      eventType,
      produce: (e) => {
        const tenderId = str(e.payload.tenderId);
        const loadId = str(e.payload.loadId);
        const reason = e.type === DOMAIN_EVENT_TYPES.TENDER_EXPIRED ? 'expired' : 'declined';
        return [
          {
            type: OperationalTaskType.EXCEPTION,
            category: 'TENDER_FAILURE',
            severity: 'WARNING',
            title: `Tender ${reason} on load ${str(e.payload.loadNumber) || loadId}`,
            subjectType: 'load',
            subjectId: loadId,
            dedupKey: `TENDER_FAILURE:${tenderId}`,
            details: { ...e.payload, reason },
            assignHint: 'AUTO',
          },
        ];
      },
    }),
  ),
];

const POLICIES_BY_EVENT = new Map<string, Policy[]>();
for (const p of POLICIES) {
  const arr = POLICIES_BY_EVENT.get(p.eventType) ?? [];
  arr.push(p);
  POLICIES_BY_EVENT.set(p.eventType, arr);
}

export function resolvePolicies(event: DomainEventInput): TaskSpec[] {
  return (POLICIES_BY_EVENT.get(event.type) ?? []).flatMap((p) => p.produce(event));
}
