import { directoryValidity, type DirectoryEntryData } from './party-directory';

export const DOCUMENT_COORDINATE_ROLES = ['billingAddress', 'deliveryAddress', 'contact'] as const;
export type DocumentCoordinateRole = (typeof DOCUMENT_COORDINATE_ROLES)[number];
export const DOCUMENT_COORDINATE_LABELS: Record<DocumentCoordinateRole, string> = {
  billingAddress: 'Adresse de facturation',
  deliveryAddress: 'Adresse de livraison / intervention',
  contact: 'Contact du dossier',
};
// Supplier identity/contact only. Receiving destinations belong to the buyer/WMS,
// never to a supplier directory; that separate commitment is not implemented here.
export const SUPPLIER_COORDINATE_ROLES: readonly DocumentCoordinateRole[] = [
  'billingAddress',
  'contact',
];
export const SUPPLIER_COORDINATE_LABELS: Record<DocumentCoordinateRole, string> = {
  billingAddress: 'Adresse du fournisseur',
  deliveryAddress: 'Destination de réception (hors carnet fournisseur)',
  contact: 'Contact fournisseur de la commande',
};
export interface CoordinateReference {
  id: string;
  version: number;
}
export type CoordinateSelections = Record<DocumentCoordinateRole, CoordinateReference | null>;
export interface CoordinateCopy extends CoordinateReference {
  data: DirectoryEntryData;
}
export interface DocumentCoordinates {
  schemaVersion: 1;
  owner: {
    kind: 'customer' | 'partner' | 'crm-company' | 'supplier';
    id: string;
    code: string;
    name: string;
  };
  entries: Record<DocumentCoordinateRole, CoordinateCopy | null>;
  selectedAt: string;
  selectedBy: string;
  reason: string;
  referenceDate: string;
  timeZone: string;
  frozenAt: string | null;
}
export interface CoordinateIssue {
  role: DocumentCoordinateRole;
  message: string;
}
/** Review is display-only; the committing writer always repeats it under its lock. */
export function reviewDocumentCoordinates(
  captured: DocumentCoordinates,
  current: Array<CoordinateCopy>,
  onDate: string,
): CoordinateIssue[] {
  const issues: CoordinateIssue[] = [];
  for (const role of DOCUMENT_COORDINATE_ROLES) {
    const selected = captured.entries[role];
    if (!selected) continue;
    const row = current.find((r) => r.id === selected.id);
    if (!row)
      issues.push({ role, message: 'Cette entrée ne fait plus partie du carnet du partenaire.' });
    else if (row.version !== selected.version)
      issues.push({
        role,
        message: `Le carnet est passé à la version ${row.version}. Choisissez explicitement la version à jour.`,
      });
    else if (directoryValidity(row.data, onDate) !== 'ACTIVE')
      issues.push({
        role,
        message: 'Cette entrée est désactivée ou hors de sa période de validité.',
      });
    else if (row.data.kind !== (role === 'contact' ? 'CONTACT' : 'ADDRESS'))
      issues.push({ role, message: 'Le type de coordonnée ne correspond pas à cet usage.' });
  }
  return issues;
}
