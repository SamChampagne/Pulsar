import type { Tone } from '$lib/components/ui';

export const freightStatus: Record<string, { label: string; tone: Tone }> = {
  RECEIVED: { label: 'À rapprocher', tone: 'neutral' },
  MATCHED: { label: 'Conforme', tone: 'ok' },
  FLAGGED: { label: 'Écart à examiner', tone: 'warn' },
  DISPUTED: { label: 'En litige', tone: 'danger' },
  RESOLVED: { label: 'Litige résolu', tone: 'ok' },
  PAID: { label: 'Réglée (suivi)', tone: 'ok' },
};

export const freightReasons: Record<string, string> = {
  RATE_MISMATCH: 'Écart de tarif',
  QUANTITY_MISMATCH: 'Écart de quantité',
  UNEXPECTED_CHARGE: 'Frais inattendus',
  DUPLICATE_BILLING: 'Facturation en double',
  OTHER: 'Autre motif',
};

export interface FreightInvoice {
  id: string;
  carrierInvoiceNumber: string;
  currency: string;
  chargedTotal: string;
  matchedTotal: string | null;
  varianceTotal: string | null;
  varianceGross: string | null;
  recoveredAmount: string | null;
  status: string;
  carrier: { name: string };
  receivedAt?: string;
  resolvedAt?: string | null;
  paidAt?: string | null;
  disputeReasonCode?: string | null;
  disputeNote?: string | null;
  resolution?: string | null;
  customData?: Record<string, unknown>;
  lines: {
    id: string;
    lineRef: string;
    description: string | null;
    chargedAmount: string;
    matchedLoadId: string | null;
    expectedAmount: string | null;
    variance: string | null;
  }[];
}
