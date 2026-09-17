/**
 * Warehouse units of measure (pure, browser-safe).
 *
 * `Item.unit` in the WMS module is a plain string; this catalog is the closed
 * vocabulary offered in the UI (rule 53) so two sites never end up with "PAL"
 * and "Palette" for the same thing. Values already stored outside this list
 * keep working — the catalog drives the picker, not validation.
 */
import type { ReferenceEntry } from './geo';

export const WMS_UNITS: readonly ReferenceEntry[] = [
  { code: 'EA', name: 'Unité' },
  { code: 'KG', name: 'Kilogramme' },
  { code: 'LB', name: 'Livre' },
  { code: 'L', name: 'Litre' },
  { code: 'M', name: 'Mètre' },
  { code: 'PAL', name: 'Palette' },
  { code: 'BOX', name: 'Boîte' },
  { code: 'CS', name: 'Caisse' },
];
