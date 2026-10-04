import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ALL_PERMISSION_KEYS } from '@pulsar/shared';
import { WMS_FIELD_GUIDES } from './wms-field-reference';

const root = resolve(process.cwd(), '../..');
const guide = (key: string) => WMS_FIELD_GUIDES.find((entry) => entry.key === key)!;
const field = (topic: string, key: string) =>
  guide(topic).fields.find((entry) => entry.key === key)!;

describe('WMS implemented field reference', () => {
  it('declares eight bounded subjects and 76 unique-per-subject fields', () => {
    expect(WMS_FIELD_GUIDES.map((entry) => entry.key)).toEqual([
      'wms-items',
      'wms-bins',
      'wms-receipts',
      'wms-picking',
      'wms-movements',
      'wms-counts',
      'wms-lots',
      'wms-stock-exits',
    ]);
    expect(WMS_FIELD_GUIDES.reduce((sum, entry) => sum + entry.fields.length, 0)).toBe(76);
    for (const entry of WMS_FIELD_GUIDES) {
      expect(new Set(entry.fields.map((value) => value.key)).size).toBe(entry.fields.length);
      expect(entry.fields.length).toBeGreaterThanOrEqual(6);
    }
  });

  it('provides the same nine explanations and nonempty defaults as the existing dictionary', () => {
    for (const entry of WMS_FIELD_GUIDES) {
      expect(entry.summary.trim()).not.toBe('');
      expect(entry.rules.length).toBeGreaterThanOrEqual(3);
      for (const value of entry.fields) {
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
          expect(value[key].trim(), `${entry.key}.${value.key}.${key}`).not.toBe('');
        if (value.defaultValue !== undefined) expect(value.defaultValue.trim()).not.toBe('');
      }
    }
  });

  it('uses the actual WMS domain, active module and catalogued read permission without granting writes', () => {
    const navigation = readFileSync(
      resolve(root, 'apps/web/src/lib/modules/navigation.ts'),
      'utf8',
    );
    expect(navigation).toContain("key: 'wms'");
    for (const entry of WMS_FIELD_GUIDES) {
      expect(entry.domain).toBe('wms');
      expect(entry.modules).toEqual(['wms']);
      expect(entry.permissions).toEqual(['wms.read']);
      for (const permission of entry.permissions) expect(ALL_PERMISSION_KEYS).toContain(permission);
      expect(entry.examples).toBeUndefined();
    }
    for (const permission of [
      'wms.manage',
      'wms.lots.release',
      'wms.stock.dispose',
      'wms.stock.return',
    ])
      expect(ALL_PERMISSION_KEYS).toContain(permission);
  });

  it('cites existing contracts and UI files and links only to existing entry routes', () => {
    for (const entry of WMS_FIELD_GUIDES) {
      expect(entry.sources.length).toBeGreaterThanOrEqual(3);
      for (const source of entry.sources)
        expect(existsSync(resolve(root, source)), source).toBe(true);
      expect(
        existsSync(resolve(root, 'apps/web/src/routes/(app)', entry.href.slice(1), '+page.svelte')),
        entry.href,
      ).toBe(true);
    }
    expect(guide('wms-lots').summary).toContain('Articles → Lots');
    expect(guide('wms-lots').href).toBe('/wms/items');
  });

  it('distinguishes immutable identity, physical totals and a target stock level', () => {
    expect(field('wms-items', 'lotTracked').validation).toContain('toute modification');
    expect(field('wms-items', 'unit').validation).toContain('Changement bloqué');
    expect(field('wms-items', 'reorderQty').limits).toContain('pas une quantité fixe');
    expect(field('wms-items', 'reorderQty').defaultValue).toContain('reorderPoint');
    expect(field('wms-items', 'onHand').limits).toContain('quarantaine');
    expect(field('wms-bins', 'zone').limits).toContain('Aucun déplacement');
    expect(field('wms-bins', 'locationId').limits).toContain('immuable');
  });

  it('keeps line drafts and readiness separate from atomic stock confirmation', () => {
    expect(guide('wms-receipts').rules.join(' ')).toContain(
      'toutes les entrées dans une même transaction',
    );
    expect(guide('wms-picking').rules.join(' ')).toContain('Readiness ne réserve rien');
    expect(field('wms-picking', 'lines.qty').validation).toContain('article/bin/lot');
    for (const topic of ['wms-receipts', 'wms-picking']) {
      expect(field(topic, 'lines.qty').validation).toContain('trois décimales');
      expect(field(topic, 'lines.lotId').required).toContain('interdit sinon');
      expect(field(topic, 'expectedUpdatedAt').limits).toContain('réponse incertaine');
    }
  });

  it('describes signed adjustments, exact retry intentions and honest legacy units', () => {
    expect(field('wms-movements', 'qtyDelta').purpose).toContain('pas une quantité finale');
    expect(field('wms-movements', 'qtyDelta').validation).toContain('Non nul');
    expect(field('wms-movements', 'unitSnapshot').validation).toContain('NULL');
    expect(field('wms-movements', 'locationId').limits).toContain('sans locationId');
    for (const topic of ['wms-movements', 'wms-lots', 'wms-stock-exits']) {
      expect(field(topic, 'operationKey').limits).toContain('même clé et le même corps');
      expect(field(topic, 'operationKey').limits).toContain('aucune reprise automatique');
    }
  });

  it('never treats empty counts as zero or a net-zero movement as a fresh snapshot', () => {
    expect(field('wms-counts', 'counts.countedQty').limits).toContain(
      'Une case vide ne vaut jamais zéro',
    );
    expect(field('wms-counts', 'lines.unitSnapshot').limits).toContain('pas réconciliable');
    expect(field('wms-counts', 'freshness').example).toContain('total inchangé');
    expect(guide('wms-counts').rules.join(' ')).toContain('même net zéro');
    expect(guide('wms-counts').rules.join(' ')).toContain('EA au brouillon');
  });

  it('separates declared expiry, whole-lot quarantine and a permissioned manual release', () => {
    expect(field('wms-lots', 'expiresOn').limits).toContain('Ne déclenche pas de FEFO');
    expect(field('wms-lots', 'disposition').limits).toContain(
      'n’est pas une certification qualité',
    );
    expect(field('wms-lots', 'controlNote').validation).toContain('wms.lots.release');
    expect(guide('wms-lots').rules.join(' ')).toContain('tous bins et sites');
    expect(guide('wms-lots').rules.join(' ')).toContain('fonctionne sans Qualité');
    expect(guide('wms-lots').rules.join(' ')).toContain('quality.read');
  });

  it('documents strict stock-exit bounds, separate return fields and human confirmation', () => {
    expect(field('wms-stock-exits', 'quantity').validation).toContain('1 à 9 chiffres');
    expect(field('wms-stock-exits', 'quantity').validation).toContain('jusqu’à 3 après');
    for (const key of ['supplierId', 'reference', 'destination'])
      expect(field('wms-stock-exits', key).required).toMatch(/interdit/);
    expect(field('wms-stock-exits', 'confirmed').validation).toContain('exactement true');
    expect(field('wms-stock-exits', 'reviewToken').validation).toContain('compteur de mouvements');
    const rules = guide('wms-stock-exits').rules.join(' ');
    expect(rules).toContain('comptes de service et agents refusés');
    expect(rules).toContain('wms.stock.dispose');
    expect(rules).toContain('wms.stock.return');
    expect(rules).toContain('purchasing.read');
    expect(rules).toContain('Aucun avoir');
  });
});
