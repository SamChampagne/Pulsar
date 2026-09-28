/** Private descriptive data. Measurements describe ONE catalog unit; never stock conversions. */
export const CATALOG_DETAIL_FIELDS = [
  { key: 'category', label: 'Famille / catégorie', max: 120, section: 'Identification' },
  { key: 'brand', label: 'Marque', max: 120, section: 'Identification', goods: true },
  { key: 'manufacturer', label: 'Fabricant', max: 200, section: 'Identification', goods: true },
  {
    key: 'manufacturerReference',
    label: 'Référence fabricant',
    max: 120,
    section: 'Identification',
    goods: true,
  },
  { key: 'model', label: 'Modèle / variante', max: 120, section: 'Identification', goods: true },
  { key: 'revision', label: 'Révision technique', max: 80, section: 'Identification' },
  { key: 'externalReference', label: 'Référence externe', max: 120, section: 'Identification' },
  {
    key: 'lengthMm',
    label: 'Longueur (mm)',
    max: 16,
    section: 'Dimensions par unité',
    goods: true,
    decimal: true,
  },
  {
    key: 'widthMm',
    label: 'Largeur (mm)',
    max: 16,
    section: 'Dimensions par unité',
    goods: true,
    decimal: true,
  },
  {
    key: 'heightMm',
    label: 'Hauteur (mm)',
    max: 16,
    section: 'Dimensions par unité',
    goods: true,
    decimal: true,
  },
  {
    key: 'netWeightKg',
    label: 'Poids net (kg)',
    max: 16,
    section: 'Dimensions par unité',
    goods: true,
    decimal: true,
  },
  {
    key: 'packaging',
    label: 'Description de l’emballage',
    max: 1000,
    section: 'Consignes',
    goods: true,
  },
  {
    key: 'storageInstructions',
    label: 'Consignes de stockage',
    max: 2000,
    section: 'Consignes',
    goods: true,
  },
  {
    key: 'handlingInstructions',
    label: 'Consignes de manutention',
    max: 2000,
    section: 'Consignes',
    goods: true,
  },
  {
    key: 'scope',
    label: 'Périmètre de la prestation',
    max: 2000,
    section: 'Prestation',
    service: true,
  },
  {
    key: 'deliverables',
    label: 'Livrables attendus',
    max: 2000,
    section: 'Prestation',
    service: true,
  },
  { key: 'exclusions', label: 'Exclusions', max: 2000, section: 'Prestation', service: true },
  { key: 'internalNotes', label: 'Notes internes', max: 4000, section: 'Consignes' },
] as const;
export type CatalogDetails = Partial<Record<(typeof CATALOG_DETAIL_FIELDS)[number]['key'], string>>;
export function catalogDetailFields(kind: string) {
  return CATALOG_DETAIL_FIELDS.filter(
    (f) => !(('goods' in f && kind !== 'GOODS') || ('service' in f && kind !== 'SERVICE')),
  );
}
export function validateCatalogDetails(
  raw: unknown,
  kind: string,
): { value?: CatalogDetails; errors: string[] } {
  const errors: string[] = [],
    value: CatalogDetails = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return { errors: ['Fiche article invalide.'] };
  const fields = catalogDetailFields(kind);
  for (const [key, data] of Object.entries(raw)) {
    const f = fields.find((f) => f.key === key);
    if (!f) {
      errors.push(`Champ non autorisé pour cet article : ${key}.`);
      continue;
    }
    if (typeof data !== 'string' || data.length > f.max) {
      errors.push(`${f.label} : texte limité à ${f.max} caractères.`);
      continue;
    }
    const text = data.trim();
    if (
      text &&
      'decimal' in f &&
      (!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,4})?$/.test(text) || !/[1-9]/.test(text))
    ) {
      errors.push(`${f.label} : décimal positif, 9 chiffres et 4 décimales maximum.`);
      continue;
    }
    if (text) value[f.key] = text;
  }
  return errors.length ? { errors } : { value, errors };
}

/** Explicitly selected by the buyer. Quantity and price always refer to catalog unit. */
export interface SupplierTermsSnapshot {
  schemaVersion: 1;
  offerId: string;
  version: number;
  supplierId: string;
  catalogItemId: string;
  supplierReference: string;
  unit: string;
  currency: string;
  unitPrice: string;
  minimumQuantity: string | null;
  orderMultiple: string | null;
  leadTimeDays: number | null;
  validFrom: string | null;
  validUntil: string | null;
  packaging: string;
  terms: string;
  capturedAt: string;
}
