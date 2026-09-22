import { ForbiddenException } from '@nestjs/common';
/** Only business endpoints may create, inspect or remove these documents. */
export const PROTECTED_DOCUMENT_TYPES = ['quality-evidence'];
export function assertGenericDocumentType(entityType: string) {
  if (PROTECTED_DOCUMENT_TYPES.includes(entityType))
    throw new ForbiddenException(
      'Ce fichier est protégé par son module métier. Utilisez le dossier Qualité.',
    );
}
