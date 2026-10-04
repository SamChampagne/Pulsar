import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MANUFACTURING_FIELD_GUIDES as guides } from './manufacturing-field-reference';
import { visibleFieldGuides, matchesField, matchesFieldGuide } from './field-reference';
import {
  MrpEntryKind,
  MrpSourcingMethod,
  ManufacturingPriority,
  ManufacturingFirmness,
} from '@pulsar/shared';

const root = resolve(process.cwd(), '../..');
const guide = (key: string) => guides.find((entry) => entry.key === `manufacturing-${key}`)!;
const field = (topic: string, key: string) =>
  guide(topic).fields.find((entry) => entry.key === key)!;
const visible = (modules: string[], permissions: string[], domains = ['manufacturing']) =>
  visibleFieldGuides({
    modules,
    domains,
    can: (permission) => permissions.includes(permission),
  }).filter((entry) => entry.domain === 'manufacturing');

describe('Manufacturing field reference from implemented contracts', () => {
  it('has nine coherent topics and 106 complete, unique field/control explanations', () => {
    expect(guides).toHaveLength(9);
    expect(guides.reduce((count, entry) => count + entry.fields.length, 0)).toBe(106);
    expect(new Set(guides.map((entry) => entry.key)).size).toBe(9);
    for (const entry of guides) {
      expect(entry.domain).toBe('manufacturing');
      expect(entry.permissions).toContain('manufacturing.read');
      expect(entry.modules).toContain('manufacturing');
      expect(new Set(entry.fields.map((item) => item.key)).size).toBe(entry.fields.length);
      for (const item of entry.fields)
        for (const key of [
          'key',
          'label',
          'purpose',
          'type',
          'required',
          'validation',
          'example',
          'effect',
          'limits',
        ] as const)
          expect(item[key].trim(), `${entry.key}.${item.key}.${key}`).not.toBe('');
    }
  });
  it('uses real source files and implemented routes, not planned process screens', () => {
    for (const entry of guides) {
      for (const source of entry.sources)
        expect(existsSync(resolve(root, source)), source).toBe(true);
      expect(
        existsSync(resolve(root, 'apps/web/src/routes/(app)', entry.href.slice(1), '+page.svelte')),
        entry.href,
      ).toBe(true);
    }
  });
  it('keeps standalone manufacturing resources, BOM, OF and non-material APS readable without WMS', () => {
    expect(visible(['manufacturing'], ['manufacturing.read']).map((entry) => entry.key)).toEqual([
      'manufacturing-resources',
      'manufacturing-boms',
      'manufacturing-orders',
      'manufacturing-aps',
    ]);
    expect(guide('boms').rules.join(' ')).toContain(
      'publier exige manufacturing.manage, wms.read et WMS actif',
    );
    expect(guide('aps').rules.join(' ')).toContain(
      'tout artefact avec matières exige aussi WMS et wms.read',
    );
  });
  it('requires activated WMS and its permission independently, and CRM only for sales-unit topics', () => {
    expect(visible(['manufacturing'], ['manufacturing.read', 'wms.read'])).toHaveLength(4);
    expect(visible(['manufacturing', 'wms'], ['manufacturing.read'])).toHaveLength(4);
    expect(visible(['manufacturing', 'wms'], ['manufacturing.read', 'wms.read'])).toHaveLength(8);
    expect(
      visible(['manufacturing', 'wms', 'crm'], ['manufacturing.read', 'wms.read']),
    ).toHaveLength(8);
    expect(
      visible(['manufacturing', 'wms', 'crm'], ['manufacturing.read', 'wms.read', 'crm.read']),
    ).toHaveLength(9);
    expect(
      visible(['manufacturing', 'wms'], ['manufacturing.read', 'wms.read', 'crm.read']),
    ).toHaveLength(8);
  });
  it('does not bypass domain or base read permissions', () => {
    expect(
      visible(['manufacturing', 'wms', 'crm'], ['manufacturing.read', 'wms.read', 'crm.read'], []),
    ).toEqual([]);
    expect(visible(['manufacturing', 'wms'], ['manufacturing.manage', 'wms.read'])).toEqual([]);
    expect(visible(['wms'], ['manufacturing.read', 'wms.read'])).toEqual([]);
  });
  it('supports accent-insensitive search of quantity, provenance and exact technical fields', () => {
    expect(matchesField(field('boms', 'quantityPerUnit'), 'QUANTITE unite')).toBe(true);
    expect(matchesField(field('shop-floor', 'consumptions.lotId'), 'consumptions.lotId')).toBe(
      true,
    );
    expect(matchesFieldGuide(guide('sales-units'), 'denominateur')).toBe(true);
    expect(matchesFieldGuide(guide('aps'), 'fenetres UTC')).toBe(true);
    expect(matchesFieldGuide(guide('resources'), 'batch commande fournisseur')).toBe(false);
  });
  it('documents different exact precisions, signs and finite horizons rather than one generic numeric input', () => {
    expect(field('boms', 'quantityPerUnit').validation).toContain('9 décimales');
    expect(field('demand', 'quantity').validation).toContain('3 décimales');
    expect(field('demand', 'quantity').validation).toContain('Strictement positive');
    expect(field('sales-units', 'numerator').type).toContain('6 décimales');
    expect(field('sales-units', 'denominator').limits).toContain('jamais arrondi');
    expect(field('purchases', 'unitPrice').validation).toContain('0 à 1 milliard');
    expect(field('mrp', 'orderMultiple').validation).toContain('zéro refusé');
    expect(field('mrp', 'horizonEnd').validation).toContain('730 jours');
    expect(field('aps', 'horizonDays').validation).toContain('365');
  });
  it('uses the actual shared enums for choices', () => {
    for (const value of Object.values(MrpEntryKind))
      expect(field('demand', 'kind').type).toContain(value);
    for (const value of Object.values(MrpSourcingMethod))
      expect(field('mrp', 'method').type).toContain(value);
    for (const value of Object.values(ManufacturingPriority))
      expect(field('orders', 'priority').type).toContain(value);
    for (const value of Object.values(ManufacturingFirmness))
      expect(field('orders', 'firmness').type).toContain(value);
  });
  it('keeps MRP preparation, supplier commitment and WMS stock posting distinct', () => {
    expect(guide('mrp').rules.join(' ')).toContain('ne modifie aucun stock, achat ou OF');
    expect(guide('mrp').rules.join(' ')).toContain(
      'BUY crée une demande interne; MAKE crée un OF DRAFT',
    );
    expect(field('purchases', 'supplierReference').limits).toContain(
      'ne transmet ni courriel, SMS',
    );
    expect(guide('purchases').rules.join(' ')).toContain(
      'Seule sa validation WMS POSTED ajoute du stock',
    );
    expect(field('purchases', 'amendment.kind').limits).toContain(
      'distinct d’une réception complète',
    );
  });
  it('explains lots, zero consumption, scrap and complete reversal without claiming batch manufacturing', () => {
    expect(field('shop-floor', 'consumptions.lotId').required).toContain('interdit sur zéro');
    expect(field('shop-floor', 'outputLotId').limits).toContain(
      'Plusieurs lots finis exigent plusieurs déclarations',
    );
    expect(field('shop-floor', 'scrapQuantity').effect).toContain('sans stock de produit fini');
    expect(guide('shop-floor').rules.join(' ')).toContain(
      'généalogie directe de cette déclaration seulement',
    );
    expect(field('shop-floor', 'reversal.reason').limits).toContain('pas de correction partielle');
    expect(field('orders', 'quantity').limits).toContain(
      'pas de quantité de recette/batch fractionnaire',
    );
    expect(guide('shop-floor').rules.join(' ')).toContain('pas désassembler physiquement');
  });
  it('documents immutable scenarios, separate MRP/APS horizons and guarded publication', () => {
    expect(guide('aps').rules.join(' ')).toContain('fenêtres UTC figées');
    expect(field('aps', 'replayedFromId').limits).toContain('ne peut pas être publié');
    expect(field('aps', 'reviewToken').limits).toContain('pas de retry automatique');
    expect(field('aps', 'timeZone').limits).toContain('pas encore un fuseau indépendant par usine');
    expect(guide('aps').rules.join(' ')).toContain('même après contrepassation');
  });
  it('grounds the non-obvious defaults and weekday convention in current writers/UI', () => {
    const orderService = readFileSync(
      resolve(root, 'apps/api/src/modules/manufacturing/orders/orders.service.ts'),
      'utf8',
    );
    const calendarUi = readFileSync(
      resolve(root, 'apps/web/src/routes/(app)/manufacturing/calendars/+page.svelte'),
      'utf8',
    );
    expect(orderService).toContain('quantity: dto.quantity ?? 1');
    expect(field('orders', 'quantity').defaultValue).toContain('1 à la création');
    expect(calendarUi).toContain("['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']");
    expect(field('resources', 'shift.weekday').validation).toContain('0 = lundi');
    expect(field('resources', 'workCenter.efficiency').limits).toContain('85');
  });
});
