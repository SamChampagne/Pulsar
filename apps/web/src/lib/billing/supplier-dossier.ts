import type { summarizeSupplierDossier } from '@pulsar/shared';
export type SupplierIdentity = {
  id: string;
  code: string;
  name: string;
  active: boolean;
  isSupplier: boolean;
};
export type SupplierOverview = ReturnType<typeof summarizeSupplierDossier> & {
  supplier: SupplierIdentity;
  asOf: string;
};
export type SupplierDocumentRow = {
  kind: 'INVOICE' | 'CREDIT';
  id: string;
  invoiceId: string;
  number: string;
  externalNumber: string;
  invoiceNumber: string;
  documentDate: string;
  createdAt: string;
  currency: string;
  status: string;
  totalAmount: string;
  hasOriginal: boolean;
  supplierNameSnapshot: string;
};
export type SupplierEvidenceRow = Omit<
  SupplierDocumentRow,
  'totalAmount' | 'hasOriginal' | 'supplierNameSnapshot'
> & {
  parentId: string;
  caption: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  isOriginal: boolean;
};
export const supplierDocumentLabels: Record<string, string> = {
  DRAFT: 'Brouillon',
  QUALIFIED: 'Qualifié',
  CANCELLED: 'Annulé',
};
export function supplierDocumentHref(row: {
  kind: 'INVOICE' | 'CREDIT';
  invoiceId: string;
  id: string;
  parentId?: string;
}) {
  const q = new URLSearchParams({ invoiceId: row.invoiceId });
  if (row.kind === 'CREDIT') q.set('creditId', row.parentId ?? row.id);
  return `/billing/supplier-invoices?${q}`;
}
