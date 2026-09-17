// Pure, browser-safe. No Node imports.
//
// X12 210 — Motor Carrier Freight Details and Invoice → canonical carrier invoice, ready for
// `FreightAuditService` (`IncomingCarrierInvoice` + its lines).
//
// Segments handled: B3 (invoice number, shipment id, date, net amount, SCAC), C3 (currency),
// N9 references, the N1/N2/N3/N4 party loops, and the charge detail LX / L5 / L0 / L1, closed by
// the L3 totals.
//
// Money: B3-07, L1-04 and L3-05 are X12 `N2` — two implied decimals. `fromImpliedDecimal`
// converts them (`'268550'` → `2685.5`); a value that already carries an explicit `.` is read
// as-is.

import {
  applyPartySegment,
  fromImpliedDecimal,
  readReference,
  x12DateToIso,
  x12Element,
  x12Number,
  type X12Party,
  type X12Reference,
  type X12Segment,
  type X12Transaction,
} from './x12';

export interface CanonicalInvoiceLine {
  /** L1-01 / L5-01 lading line item number. */
  lineNumber?: number;
  /** L1-12 special charge description, else the L5-02 description of the same LX loop. */
  description?: string;
  /** L1-04, implied 2 decimals. */
  amount: number;
  /** L1-08 special charge or allowance code (`'400'` stop-off, `'405'` fuel surcharge…). */
  chargeCode?: string;
  /** L1-02 freight rate + L1-03 rate qualifier. */
  rate?: number;
  rateQualifier?: string;
  /** L0-08 lading quantity, else L0-02 billed quantity. */
  qty?: number;
  /** L0-09 packaging form code, else L0-03 billed quantity qualifier. */
  unit?: string;
  /** L0-04 + L0-11. */
  weight?: number;
  weightUnit?: string;
  commodityCode?: string;
}

export interface CanonicalCarrierInvoice {
  /** B3-02. */
  invoiceNumber: string;
  /** B3-03 — the shipment identification number, i.e. what the 204 tendered. */
  shipmentId?: string;
  /** B3-11. */
  carrierScac?: string;
  /** B3-06, `YYYY-MM-DD`. */
  date?: string;
  /** B3-09, `YYYY-MM-DD`. */
  deliveryDate?: string;
  /** B3-04 (`PP` prepaid, `CC` collect…). */
  methodOfPayment?: string;
  /** B3-07 net amount due. */
  netAmount?: number;
  /** L3-05 when present, else B3-07, else the sum of the lines. */
  total: number;
  /** C3-01. */
  currency?: string;
  /** L3-01 + L3-12. */
  weight?: number;
  weightUnit?: string;
  lines: CanonicalInvoiceLine[];
  references: X12Reference[];
  parties: X12Party[];
}

function emptyLine(): CanonicalInvoiceLine {
  return { amount: 0 };
}

function hasContent(line: CanonicalInvoiceLine): boolean {
  return (
    line.amount !== 0 ||
    line.description !== undefined ||
    line.chargeCode !== undefined ||
    line.qty !== undefined ||
    line.weight !== undefined
  );
}

/**
 * Map a parsed 210 transaction to a canonical carrier invoice. Never throws; a 210 with no B3
 * yields an empty `invoiceNumber`, which the caller rejects.
 */
export function read210(transaction: X12Transaction): CanonicalCarrierInvoice {
  const invoice: CanonicalCarrierInvoice = {
    invoiceNumber: '',
    total: 0,
    lines: [],
    references: [],
    parties: [],
  };

  let line: CanonicalInvoiceLine | null = null;
  let party: X12Party | null = null;
  let totalFromL3: number | undefined;

  const flushLine = () => {
    if (line && hasContent(line)) invoice.lines.push(line);
    line = null;
  };
  const flushParty = () => {
    if (party) invoice.parties.push(party);
    party = null;
  };
  for (const segment of transaction.segments) {
    switch (segment.tag) {
      case 'B3':
        invoice.invoiceNumber = x12Element(segment, 2) ?? '';
        invoice.shipmentId = x12Element(segment, 3);
        invoice.methodOfPayment = x12Element(segment, 4);
        invoice.weightUnit = x12Element(segment, 5);
        invoice.date = x12DateToIso(x12Element(segment, 6));
        invoice.netAmount = fromImpliedDecimal(x12Element(segment, 7));
        invoice.deliveryDate = x12DateToIso(x12Element(segment, 9));
        invoice.carrierScac = x12Element(segment, 11);
        break;
      case 'C3':
        invoice.currency = x12Element(segment, 1);
        break;
      case 'N9': {
        const reference = readReference(segment);
        if (reference) invoice.references.push(reference);
        break;
      }
      case 'N1':
        flushParty();
        party = applyPartySegment({}, segment);
        break;
      case 'N2':
      case 'N3':
      case 'N4':
        if (party) applyPartySegment(party, segment);
        break;
      case 'LX':
        flushParty();
        flushLine();
        break;
      case 'L5': {
        line = line ?? emptyLine();
        const target = line;
        target.lineNumber = target.lineNumber ?? x12Number(x12Element(segment, 1));
        target.description = target.description ?? x12Element(segment, 2);
        target.commodityCode = target.commodityCode ?? x12Element(segment, 3);
        break;
      }
      case 'L0': {
        line = line ?? emptyLine();
        const target = line;
        target.lineNumber = target.lineNumber ?? x12Number(x12Element(segment, 1));
        target.qty = x12Number(x12Element(segment, 8)) ?? x12Number(x12Element(segment, 2));
        target.unit = x12Element(segment, 9) ?? x12Element(segment, 3);
        target.weight = x12Number(x12Element(segment, 4));
        target.weightUnit = x12Element(segment, 11) ?? x12Element(segment, 5);
        break;
      }
      case 'L1': {
        // A second L1 in the same loop starts a new charge line.
        if (line !== null && line.amount !== 0) flushLine();
        line = line ?? emptyLine();
        const target = line;
        target.lineNumber = x12Number(x12Element(segment, 1)) ?? target.lineNumber;
        target.rate = x12Number(x12Element(segment, 2));
        target.rateQualifier = x12Element(segment, 3);
        target.amount = fromImpliedDecimal(x12Element(segment, 4)) ?? 0;
        target.chargeCode = x12Element(segment, 8);
        target.description = x12Element(segment, 12) ?? target.description;
        break;
      }
      case 'L3': {
        flushLine();
        invoice.weight = x12Number(x12Element(segment, 1)) ?? invoice.weight;
        invoice.weightUnit = x12Element(segment, 12) ?? invoice.weightUnit;
        totalFromL3 = fromImpliedDecimal(x12Element(segment, 5));
        break;
      }
      default:
        break;
    }
  }
  flushLine();
  flushParty();

  const summed = invoice.lines.reduce((sum, item) => sum + item.amount, 0);
  invoice.total = totalFromL3 ?? invoice.netAmount ?? Math.round(summed * 100) / 100;
  return invoice;
}
