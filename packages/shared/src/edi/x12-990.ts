// Pure, browser-safe. No Node imports.
//
// X12 990 — Response to a Load Tender (accept / decline).
//
// Segments emitted: B1 (SCAC, shipment id, date, reservation action code), N9 references
// (optional), K1 remark carrying the human reason (optional), inside the usual ST/SE envelope.

import {
  buildX12Interchange,
  readReference,
  x12Element,
  x12DateToIso,
  x12Segment,
  x12Stamp,
  X12_FUNCTIONAL_IDS,
  type X12EnvelopeOptions,
  type X12Reference,
  type X12Segment,
  type X12Transaction,
} from './x12';

/** B1-04 reservation action codes. */
export const X12_RESERVATION_ACTIONS = {
  ACCEPT: 'A',
  DECLINE: 'D',
} as const;

export type X12ReservationAction =
  (typeof X12_RESERVATION_ACTIONS)[keyof typeof X12_RESERVATION_ACTIONS];

/** Max characters of a K1 element (X12 K101 is AN 1/30). Longer reasons spill into K1-02. */
const K1_ELEMENT_LENGTH = 30;

export interface X12TenderReply {
  accept: boolean;
  /** Free text; travels in K1 (split over K1-01/K1-02, truncated past 60 characters). */
  reason?: string;
  /** B1-03; defaults to the envelope stamp. */
  date?: string | Date;
  /** Extra N9 references (`{ qualifier: 'CN', value: 'SHP-1' }`). */
  references?: X12Reference[];
}

export interface X12TenderRef {
  /** B1-02 — the shipment identification number received in the 204. */
  shipmentId: string;
  /** B1-01 — SCAC. */
  scac?: string;
}

/** Transaction-level segments of a 990 (ST/SE excluded). */
export function build990Segments(tender: X12TenderRef, reply: X12TenderReply): X12Segment[] {
  const stamp = x12Stamp(reply.date);
  const action = reply.accept ? X12_RESERVATION_ACTIONS.ACCEPT : X12_RESERVATION_ACTIONS.DECLINE;
  const segments: X12Segment[] = [
    x12Segment('B1', tender.scac, tender.shipmentId, stamp.date, action),
  ];
  for (const reference of reply.references ?? []) {
    segments.push(x12Segment('N9', reference.qualifier, reference.value, reference.description));
  }
  const reason = reply.reason?.trim();
  if (reason) {
    segments.push(
      x12Segment(
        'K1',
        reason.slice(0, K1_ELEMENT_LENGTH),
        reason.slice(K1_ELEMENT_LENGTH, K1_ELEMENT_LENGTH * 2),
      ),
    );
  }
  return segments;
}

/**
 * Build a complete 990 interchange answering a 204.
 *
 * `reply.date` defaults to `envelope.at`, so a caller that stamps the envelope gets a coherent
 * B1-03 for free.
 */
export function build990(
  tender: X12TenderRef,
  reply: X12TenderReply,
  envelope: X12EnvelopeOptions,
): string {
  const segments = build990Segments(tender, { ...reply, date: reply.date ?? envelope.at });
  return buildX12Interchange(envelope, X12_FUNCTIONAL_IDS['990'], '990', segments);
}

export interface CanonicalTenderResponse {
  scac?: string;
  shipmentId: string;
  /** `YYYY-MM-DD`. */
  date?: string;
  action?: string;
  accepted: boolean;
  declined: boolean;
  reason?: string;
  references: X12Reference[];
}

/** Read a 990 back (used by the round-trip tests, and by a carrier-side integration). */
export function read990(transaction: X12Transaction): CanonicalTenderResponse {
  const response: CanonicalTenderResponse = {
    shipmentId: '',
    accepted: false,
    declined: false,
    references: [],
  };
  const reasonParts: string[] = [];
  for (const segment of transaction.segments) {
    switch (segment.tag) {
      case 'B1':
        response.scac = x12Element(segment, 1);
        response.shipmentId = x12Element(segment, 2) ?? '';
        response.date = x12DateToIso(x12Element(segment, 3));
        response.action = x12Element(segment, 4);
        response.accepted = response.action === X12_RESERVATION_ACTIONS.ACCEPT;
        response.declined = response.action === X12_RESERVATION_ACTIONS.DECLINE;
        break;
      case 'N9': {
        const reference = readReference(segment);
        if (reference) response.references.push(reference);
        break;
      }
      case 'K1': {
        const first = x12Element(segment, 1);
        const second = x12Element(segment, 2);
        if (first) reasonParts.push(first);
        if (second) reasonParts.push(second);
        break;
      }
      default:
        break;
    }
  }
  if (reasonParts.length > 0) response.reason = reasonParts.join('');
  return response;
}
