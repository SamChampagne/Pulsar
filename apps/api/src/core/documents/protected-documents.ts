import { ForbiddenException } from '@nestjs/common';
/** Only business endpoints may create, inspect or remove these documents. */
export const PROTECTED_DOCUMENT_TYPES = [
  'ledger-currency-evidence',
  'supplier-invoice-evidence',
  'supplier-credit-evidence',
  'wms-stock-exit-evidence',
  'quality-evidence',
  'customer-credit-pdf',
  'customer-invoice-pdf',
];
export type ProtectedDocumentContext =
  | 'ledger-currency-evidence'
  | 'supplier-invoice-evidence'
  | 'supplier-credit-evidence'
  | 'wms-stock-exit-evidence'
  | 'quality-evidence'
  | 'customer-credit-pdf'
  | 'customer-invoice-pdf';
export function assertGenericDocumentType(entityType: string) {
  if (PROTECTED_DOCUMENT_TYPES.includes(entityType))
    throw new ForbiddenException(
      'Ce fichier est protégé par son module métier. Utilisez son dossier d’origine.',
    );
}
