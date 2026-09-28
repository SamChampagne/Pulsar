import {
  DOCUMENT_COORDINATE_LABELS,
  DOCUMENT_COORDINATE_ROLES,
  SUPPLIER_COORDINATE_LABELS,
  reviewDocumentCoordinates,
  type CoordinateCopy,
  type DocumentCoordinates,
  type DocumentCoordinateRole,
} from './document-coordinates';

export const DIRECTORY_IMPACT_SOURCES = [
  'service-quote',
  'customer-invoice',
  'transport-order',
  'crm-sales-order',
  'supplier-order',
] as const;
export type DirectoryImpactSource = (typeof DIRECTORY_IMPACT_SOURCES)[number];
export type DirectoryImpactScope = 'DRAFT' | 'FROZEN';
export interface DirectoryImpactRole {
  role: DocumentCoordinateRole;
  label: string;
  selectedVersion: number;
  issue: string | null;
}
/** Review ONLY this entry. Never imply that all coordinates/identity are ready to commit. */
export function directoryEntryImpact(
  captured: DocumentCoordinates,
  entry: CoordinateCopy,
  onDate: string,
): DirectoryImpactRole[] {
  const roles = DOCUMENT_COORDINATE_ROLES.filter((role) => captured.entries[role]?.id === entry.id);
  const focused: DocumentCoordinates = {
    ...captured,
    entries: { billingAddress: null, deliveryAddress: null, contact: null },
  };
  for (const role of roles) focused.entries[role] = captured.entries[role];
  const issues = captured.frozenAt ? [] : reviewDocumentCoordinates(focused, [entry], onDate);
  const labels =
    captured.owner.kind === 'supplier' ? SUPPLIER_COORDINATE_LABELS : DOCUMENT_COORDINATE_LABELS;
  return roles.map((role) => ({
    role,
    label: labels[role],
    selectedVersion: captured.entries[role]!.version,
    issue: issues.find((i) => i.role === role)?.message ?? null,
  }));
}
export interface DirectoryImpactView {
  entry: { id: string; label: string; version: number };
  observedAt: string;
  referenceDate: string;
  timeZone: string;
  sources: { key: DirectoryImpactSource; label: string; drafts: number; frozen: number }[];
  source: DirectoryImpactSource | null;
  scope: DirectoryImpactScope;
  page: number;
  pageSize: number;
  total: number;
  items: {
    id: string;
    number: string;
    status: string;
    updatedAt: string;
    href: string;
    frozenAt: string | null;
    roles: DirectoryImpactRole[];
  }[];
}
