// Pure, browser-safe. No Node imports.
//
// X12 214 — Transportation Carrier Shipment Status Message.
//
// Segments emitted per status: LX (loop counter), AT7 (status code + date/time), MS1 (city /
// state / country) and MS2 (SCAC + equipment number) when known. The header carries B10
// (reference number, shipment id, SCAC) and L11 references.

import {
  buildX12Interchange,
  readReference,
  x12DateTimeToIso,
  x12Element,
  x12Segment,
  x12Stamp,
  X12_FUNCTIONAL_IDS,
  type X12EnvelopeOptions,
  type X12Reference,
  type X12Segment,
  type X12Transaction,
} from './x12';
import { ShipmentStatus, TrackingEventType } from '../enums/transportation';

/**
 * AT7-01 shipment status codes Pulsar emits. This is the whole supported surface — a partner
 * asking for another code needs a new entry here (and a mapping below).
 */
export const X12_214_STATUS_CODES = {
  AA: 'Pick-up appointment date and/or time',
  AB: 'Delivery appointment date and/or time',
  AF: 'Carrier departed pick-up location with shipment',
  AG: 'Estimated delivery',
  AM: 'Loaded on truck',
  AP: 'Delivery not completed',
  A7: 'Refused by consignee',
  CA: 'Shipment cancelled',
  CD: 'Carrier departed delivery location',
  D1: 'Completed unloading at delivery location',
  P1: 'Departed terminal location',
  SD: 'Shipment delayed',
  X1: 'Arrived at delivery location',
  X3: 'Arrived at pick-up location',
  X4: 'Arrived at terminal location',
  X6: 'En route to delivery location',
} as const;

export type X12StatusCode = keyof typeof X12_214_STATUS_CODES;

export function isX12StatusCode(value: unknown): value is X12StatusCode {
  return typeof value === 'string' && value in X12_214_STATUS_CODES;
}

/**
 * Pulsar `ShipmentStatus` → AT7-01. `PENDING` has no wire equivalent (nothing has happened yet)
 * and returns `undefined`, which the builder skips.
 */
export const X12_STATUS_BY_SHIPMENT_STATUS: Partial<Record<ShipmentStatus, X12StatusCode>> = {
  [ShipmentStatus.PLANNED]: 'AA',
  [ShipmentStatus.DISPATCHED]: 'AM',
  [ShipmentStatus.IN_TRANSIT]: 'X6',
  [ShipmentStatus.DELIVERED]: 'D1',
  [ShipmentStatus.CLOSED]: 'D1',
  [ShipmentStatus.CANCELLED]: 'CA',
};

/**
 * Pulsar `TrackingEventType` → AT7-01. Arrival/departure depend on the stop: pass
 * `{ stopType: 'DELIVERY' }` to get `X1`/`CD` instead of `X3`/`AF`.
 */
export const X12_STATUS_BY_TRACKING_EVENT: Partial<Record<TrackingEventType, X12StatusCode>> = {
  [TrackingEventType.PLANNED]: 'AA',
  [TrackingEventType.DISPATCHED]: 'AM',
  [TrackingEventType.POSITION_UPDATE]: 'X6',
  [TrackingEventType.ARRIVED_AT_STOP]: 'X3',
  [TrackingEventType.DEPARTED_STOP]: 'AF',
  [TrackingEventType.DELAYED]: 'SD',
  [TrackingEventType.EXCEPTION]: 'AP',
  [TrackingEventType.DELIVERED]: 'D1',
  [TrackingEventType.CANCELLED]: 'CA',
};

export function at7ForShipmentStatus(status: ShipmentStatus | string): X12StatusCode | undefined {
  return X12_STATUS_BY_SHIPMENT_STATUS[status as ShipmentStatus];
}

export function at7ForTrackingEvent(
  type: TrackingEventType | string,
  options?: { stopType?: 'PICKUP' | 'DELIVERY' },
): X12StatusCode | undefined {
  const base = X12_STATUS_BY_TRACKING_EVENT[type as TrackingEventType];
  if (!base) return undefined;
  if (options?.stopType !== 'DELIVERY') return base;
  if (type === TrackingEventType.ARRIVED_AT_STOP) return 'X1';
  if (type === TrackingEventType.DEPARTED_STOP) return 'CD';
  return base;
}

export interface X12ShipmentStatusEvent {
  /** AT7-01 — a supported code, or any string when the partner mandates another one. */
  code: X12StatusCode | string;
  /** AT7-02 status reason code (`'A1'` missed pickup…). */
  reasonCode?: string;
  /** AT7-05/06. */
  at?: string | Date;
  /** AT7-07 time code, default `'LT'` (local time). */
  timeCode?: string;
  /** MS1. */
  city?: string;
  state?: string;
  country?: string;
  /** MS2-02 — overrides the shipment-level equipment number. */
  equipmentNumber?: string;
}

export interface X12ShipmentStatusInput {
  /** B10-01 — our reference for this status set (shipment number is a fine default). */
  referenceNumber?: string;
  /** B10-02 — shipment identification number as known by the partner. */
  shipmentId: string;
  /** B10-03 — SCAC. */
  scac?: string;
  /** L11 references. */
  references?: X12Reference[];
  /** MS2-02 default for every event. */
  equipmentNumber?: string;
  events: X12ShipmentStatusEvent[];
}

/** Transaction-level segments of a 214 (ST/SE excluded). */
export function build214Segments(shipment: X12ShipmentStatusInput): X12Segment[] {
  const segments: X12Segment[] = [
    x12Segment(
      'B10',
      shipment.referenceNumber ?? shipment.shipmentId,
      shipment.shipmentId,
      shipment.scac,
    ),
  ];
  for (const reference of shipment.references ?? []) {
    segments.push(x12Segment('L11', reference.value, reference.qualifier, reference.description));
  }
  shipment.events.forEach((event, index) => {
    const stamp = x12Stamp(event.at);
    segments.push(x12Segment('LX', String(index + 1)));
    segments.push(
      x12Segment(
        'AT7',
        event.code,
        event.reasonCode,
        undefined,
        undefined,
        stamp.date,
        stamp.time,
        stamp.time ? (event.timeCode ?? 'LT') : undefined,
      ),
    );
    if (event.city || event.state || event.country) {
      segments.push(x12Segment('MS1', event.city, event.state, event.country));
    }
    const equipmentNumber = event.equipmentNumber ?? shipment.equipmentNumber;
    if (shipment.scac || equipmentNumber) {
      segments.push(x12Segment('MS2', shipment.scac, equipmentNumber));
    }
  });
  return segments;
}

/** Build a complete 214 interchange for the current status of a shipment. */
export function build214(shipment: X12ShipmentStatusInput, envelope: X12EnvelopeOptions): string {
  return buildX12Interchange(
    envelope,
    X12_FUNCTIONAL_IDS['214'],
    '214',
    build214Segments(shipment),
  );
}

export interface CanonicalShipmentStatus {
  referenceNumber?: string;
  shipmentId: string;
  scac?: string;
  references: X12Reference[];
  events: Array<{
    code: string;
    description?: string;
    reasonCode?: string;
    /** `YYYY-MM-DD[THH:MM]`. */
    at?: string;
    timeCode?: string;
    city?: string;
    state?: string;
    country?: string;
    equipmentNumber?: string;
  }>;
}

/** Read a 214 back (round-trip tests, and carrier-sent status messages). */
export function read214(transaction: X12Transaction): CanonicalShipmentStatus {
  const status: CanonicalShipmentStatus = { shipmentId: '', references: [], events: [] };
  for (const segment of transaction.segments) {
    switch (segment.tag) {
      case 'B10':
        status.referenceNumber = x12Element(segment, 1);
        status.shipmentId = x12Element(segment, 2) ?? '';
        status.scac = x12Element(segment, 3);
        break;
      case 'L11': {
        const reference = readReference(segment);
        if (reference) status.references.push(reference);
        break;
      }
      case 'AT7': {
        const code = x12Element(segment, 1) ?? '';
        status.events.push({
          code,
          description: isX12StatusCode(code) ? X12_214_STATUS_CODES[code] : undefined,
          reasonCode: x12Element(segment, 2),
          at: x12DateTimeToIso(x12Element(segment, 5), x12Element(segment, 6)),
          timeCode: x12Element(segment, 7),
        });
        break;
      }
      case 'MS1': {
        const event = status.events[status.events.length - 1];
        if (event) {
          event.city = x12Element(segment, 1);
          event.state = x12Element(segment, 2);
          event.country = x12Element(segment, 3);
        }
        break;
      }
      case 'MS2': {
        const event = status.events[status.events.length - 1];
        if (event) event.equipmentNumber = x12Element(segment, 2);
        break;
      }
      default:
        break;
    }
  }
  return status;
}
