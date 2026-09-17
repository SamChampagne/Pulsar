// Pure, browser-safe. No Node imports.
//
// X12 204 — Motor Carrier Load Tender → canonical Pulsar tender.
//
// Segments handled: B2, B2A, L11, G61, NTE, N7, MS3, and the S5 stop loop with
// L11 / G62 / AT8 / N1-N2-N3-N4 / G61 / L5 / OID / LAD / NTE.
// Anything else is ignored (kept in `transaction.segments` for the caller).

import {
  applyPartySegment,
  readContact,
  readReference,
  x12DateTimeToIso,
  x12DateToIso,
  x12Element,
  x12Number,
  x12TimeToIso,
  type X12Contact,
  type X12Party,
  type X12Reference,
  type X12Segment,
  type X12Transaction,
} from './x12';

/** B2A-01 transaction set purpose codes we recognise. */
export const X12_TENDER_PURPOSES = {
  '00': 'ORIGINAL',
  '01': 'CANCELLATION',
  '04': 'CHANGE',
  '05': 'REPLACE',
} as const;

export type X12TenderPurpose =
  | (typeof X12_TENDER_PURPOSES)[keyof typeof X12_TENDER_PURPOSES]
  | 'UNKNOWN';

/** S5-02 stop reason codes → stop type. */
export const X12_STOP_REASON_CODES = {
  CL: 'PICKUP', // Complete Load
  LD: 'PICKUP', // Load
  PL: 'PICKUP', // Partial Load
  CU: 'DELIVERY', // Complete Unload
  UL: 'DELIVERY', // Unload
  PU: 'DELIVERY', // Partial Unload
} as const;

export type X12StopType = 'PICKUP' | 'DELIVERY' | 'OTHER';

/**
 * G62-01 date qualifiers that mean "not before" (earliest) and "no later than" (latest).
 * Anything else is kept in `dates[]` but does not feed `earliestAt`/`latestAt`.
 */
export const X12_EARLIEST_DATE_QUALIFIERS = ['10', '37', '53', '64', '69', '78'] as const;
export const X12_LATEST_DATE_QUALIFIERS = ['38', '54', '65', '70', '77'] as const;

export interface X12StopDate {
  /** G62-01. */
  qualifier: string;
  /** `YYYY-MM-DD`. */
  date?: string;
  /** G62-03. */
  timeQualifier?: string;
  /** `HH:MM`. */
  time?: string;
  /** G62-05 — `'LT'` local time, `'UT'` UTC… */
  timeCode?: string;
  /** `YYYY-MM-DD[THH:MM]`, local to the partner (X12 carries no offset). */
  at?: string;
}

/** N7 equipment details. */
export interface X12Equipment {
  /** N7-01 equipment initial (reporting marks). */
  initial?: string;
  /** N7-02 equipment number. */
  number?: string;
  /** N7-03 / N7-04. */
  weight?: number;
  weightQualifier?: string;
  /** N7-08 / N7-09. */
  volume?: number;
  volumeUnit?: string;
  /** N7-11 equipment description code — `'TL'` trailer, `'CN'` container… */
  descriptionCode?: string;
  /** N7-24 equipment length. */
  length?: number;
}

/** One lading item of a stop (L5 / OID / LAD). */
export interface X12TenderItem {
  lineNumber?: number;
  description?: string;
  commodityCode?: string;
  purchaseOrderNumber?: string;
  referenceId?: string;
  quantity?: number;
  quantityUnit?: string;
  weight?: number;
  weightUnit?: string;
  packagingCode?: string;
}

export interface CanonicalTenderStop {
  /** S5-01. */
  sequence: number;
  /** S5-02 raw reason code. */
  reasonCode: string;
  type: X12StopType;
  /** S5-03/04 or, failing that, AT8-03/02. */
  weight?: number;
  weightUnit?: string;
  /** S5-05/06 or, failing that, AT8-04. */
  quantity?: number;
  quantityUnit?: string;
  name?: string;
  entityCode?: string;
  idQualifier?: string;
  idCode?: string;
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  dates: X12StopDate[];
  /** First G62 whose qualifier means "not before". */
  earliestAt?: string;
  /** First G62 whose qualifier means "no later than". */
  latestAt?: string;
  references: X12Reference[];
  contacts: X12Contact[];
  items: X12TenderItem[];
  notes: string[];
}

export interface CanonicalLoadTender {
  /** B2-04 — the partner's shipment identification number. */
  shipmentId: string;
  /** B2-02 — SCAC of the carrier the tender is addressed to. */
  scac?: string;
  /** B2-01 country / B2-03 tariff are ignored; B2-06 method of payment (`PP`, `CC`, `TP`). */
  methodOfPayment?: string;
  /** B2A-01 raw code. */
  purposeCode: string;
  purpose: X12TenderPurpose;
  /** B2A-02 application type (`'LT'` load tender…). */
  applicationType?: string;
  /** Header-level L11 references. */
  references: X12Reference[];
  /** Header-level G61 contacts. */
  contacts: X12Contact[];
  equipment: X12Equipment[];
  stops: CanonicalTenderStop[];
  /** NTE notes found outside the stop loop. */
  notes: string[];
  /** Sum of the pickup stop weights (undefined when no stop carries a weight). */
  totalWeight?: number;
  weightUnit?: string;
}

function purposeOf(code: string | undefined): X12TenderPurpose {
  if (!code) return 'UNKNOWN';
  return X12_TENDER_PURPOSES[code as keyof typeof X12_TENDER_PURPOSES] ?? 'UNKNOWN';
}

function stopTypeOf(reasonCode: string | undefined): X12StopType {
  if (!reasonCode) return 'OTHER';
  return (X12_STOP_REASON_CODES[reasonCode as keyof typeof X12_STOP_REASON_CODES] ??
    'OTHER') as X12StopType;
}

function readEquipment(segment: X12Segment): X12Equipment {
  return {
    initial: x12Element(segment, 1),
    number: x12Element(segment, 2),
    weight: x12Number(x12Element(segment, 3)),
    weightQualifier: x12Element(segment, 4),
    volume: x12Number(x12Element(segment, 8)),
    volumeUnit: x12Element(segment, 9),
    descriptionCode: x12Element(segment, 11),
    length: x12Number(x12Element(segment, 24)),
  };
}

function readStopDate(segment: X12Segment): X12StopDate {
  const date = x12Element(segment, 2);
  const time = x12Element(segment, 4);
  return {
    qualifier: x12Element(segment, 1) ?? '',
    date: x12DateToIso(date),
    timeQualifier: x12Element(segment, 3),
    time: x12TimeToIso(time),
    timeCode: x12Element(segment, 5),
    at: x12DateTimeToIso(date, time),
  };
}

function newStop(segment: X12Segment): CanonicalTenderStop {
  const reasonCode = x12Element(segment, 2) ?? '';
  return {
    sequence: x12Number(x12Element(segment, 1)) ?? 0,
    reasonCode,
    type: stopTypeOf(reasonCode),
    weight: x12Number(x12Element(segment, 3)),
    weightUnit: x12Element(segment, 4),
    quantity: x12Number(x12Element(segment, 5)),
    quantityUnit: x12Element(segment, 6),
    dates: [],
    references: [],
    contacts: [],
    items: [],
    notes: [],
  };
}

function applyAt8(stop: CanonicalTenderStop, segment: X12Segment): void {
  const weight = x12Number(x12Element(segment, 3));
  const quantity = x12Number(x12Element(segment, 4));
  if (stop.weight === undefined && weight !== undefined) {
    stop.weight = weight;
    stop.weightUnit = stop.weightUnit ?? x12Element(segment, 2);
  }
  if (stop.quantity === undefined && quantity !== undefined) stop.quantity = quantity;
}

function applyItemSegment(stop: CanonicalTenderStop, segment: X12Segment): void {
  switch (segment.tag) {
    case 'L5': {
      stop.items.push({
        lineNumber: x12Number(x12Element(segment, 1)),
        description: x12Element(segment, 2),
        commodityCode: x12Element(segment, 3),
      });
      break;
    }
    case 'OID': {
      const item = stop.items[stop.items.length - 1] ?? {};
      if (stop.items.length === 0) stop.items.push(item);
      item.referenceId = x12Element(segment, 1);
      item.purchaseOrderNumber = x12Element(segment, 2);
      item.quantityUnit = item.quantityUnit ?? x12Element(segment, 4);
      item.quantity = item.quantity ?? x12Number(x12Element(segment, 5));
      item.weightUnit = item.weightUnit ?? x12Element(segment, 6);
      item.weight = item.weight ?? x12Number(x12Element(segment, 7));
      break;
    }
    case 'LAD': {
      const item = stop.items[stop.items.length - 1] ?? {};
      if (stop.items.length === 0) stop.items.push(item);
      item.packagingCode = x12Element(segment, 1);
      item.quantity = item.quantity ?? x12Number(x12Element(segment, 2));
      item.weightUnit = item.weightUnit ?? x12Element(segment, 3);
      item.weight = item.weight ?? x12Number(x12Element(segment, 4));
      break;
    }
    default:
      break;
  }
}

function finishStop(stop: CanonicalTenderStop): void {
  for (const date of stop.dates) {
    if (!date.at) continue;
    if (
      !stop.earliestAt &&
      (X12_EARLIEST_DATE_QUALIFIERS as readonly string[]).includes(date.qualifier)
    ) {
      stop.earliestAt = date.at;
    }
    if (
      !stop.latestAt &&
      (X12_LATEST_DATE_QUALIFIERS as readonly string[]).includes(date.qualifier)
    ) {
      stop.latestAt = date.at;
    }
  }
}

/**
 * Map a parsed 204 transaction to the canonical tender Pulsar works with.
 *
 * Never throws: missing segments simply produce empty/undefined fields. Callers validate
 * `shipmentId` and `stops.length` before creating anything.
 */
export function read204(transaction: X12Transaction): CanonicalLoadTender {
  const tender: CanonicalLoadTender = {
    shipmentId: '',
    purposeCode: '',
    purpose: 'UNKNOWN',
    references: [],
    contacts: [],
    equipment: [],
    stops: [],
    notes: [],
  };

  let stop: CanonicalTenderStop | null = null;
  let party: X12Party | null = null;

  const flushParty = () => {
    if (!stop || !party) {
      party = null;
      return;
    }
    stop.name = stop.name ?? party.name;
    stop.entityCode = stop.entityCode ?? party.entityCode;
    stop.idQualifier = stop.idQualifier ?? party.idQualifier;
    stop.idCode = stop.idCode ?? party.idCode;
    stop.address1 = stop.address1 ?? party.address1;
    stop.address2 = stop.address2 ?? party.address2;
    stop.city = stop.city ?? party.city;
    stop.state = stop.state ?? party.state;
    stop.postalCode = stop.postalCode ?? party.postalCode;
    stop.country = stop.country ?? party.country;
    party = null;
  };

  for (const segment of transaction.segments) {
    switch (segment.tag) {
      case 'B2':
        tender.scac = x12Element(segment, 2);
        tender.shipmentId = x12Element(segment, 4) ?? '';
        tender.methodOfPayment = x12Element(segment, 6);
        break;
      case 'B2A':
        tender.purposeCode = x12Element(segment, 1) ?? '';
        tender.purpose = purposeOf(tender.purposeCode);
        tender.applicationType = x12Element(segment, 2);
        break;
      case 'N7':
        tender.equipment.push(readEquipment(segment));
        break;
      case 'S5': {
        flushParty();
        if (stop) finishStop(stop);
        stop = newStop(segment);
        tender.stops.push(stop);
        break;
      }
      case 'L11': {
        const reference = readReference(segment);
        if (reference) (stop ? stop.references : tender.references).push(reference);
        break;
      }
      case 'G61': {
        const contact = readContact(segment);
        (stop ? stop.contacts : tender.contacts).push(contact);
        break;
      }
      case 'G62':
        if (stop) stop.dates.push(readStopDate(segment));
        break;
      case 'AT8':
        if (stop) applyAt8(stop, segment);
        break;
      case 'N1':
        flushParty();
        party = applyPartySegment({}, segment);
        break;
      case 'N2':
      case 'N3':
      case 'N4':
        if (party) applyPartySegment(party, segment);
        break;
      case 'L5':
      case 'OID':
      case 'LAD':
        flushParty();
        if (stop) applyItemSegment(stop, segment);
        break;
      case 'NTE': {
        const text = x12Element(segment, 2) ?? x12Element(segment, 1);
        if (text) (stop ? stop.notes : tender.notes).push(text);
        break;
      }
      default:
        break;
    }
  }
  flushParty();
  if (stop) finishStop(stop);

  const pickups = tender.stops.filter((candidate) => candidate.type === 'PICKUP');
  const weighted = (pickups.length > 0 ? pickups : tender.stops).filter(
    (candidate) => candidate.weight !== undefined,
  );
  if (weighted.length > 0) {
    tender.totalWeight = weighted.reduce((sum, candidate) => sum + (candidate.weight ?? 0), 0);
    tender.weightUnit = weighted[0].weightUnit;
  }
  return tender;
}
