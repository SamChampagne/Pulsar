import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  FIELD_GUIDES,
  matchesField,
  matchesFieldGuide,
  visibleFieldGuides,
  visibleToolExamples,
  type FieldAccess,
} from './field-reference';

const guide = (key: string) => FIELD_GUIDES.find((entry) => entry.key === key)!;
const access = (
  permissions: string[],
  domains = ['transport', 'agents'],
  modules = ['transportation'],
): FieldAccess => ({ domains, modules, can: (permission) => permissions.includes(permission) });
const root = resolve(process.cwd(), '../..');

describe('Implemented field dictionary', () => {
  it('covers declared transport, WMS, manufacturing and AI topics with unique fields and complete metadata', () => {
    expect(FIELD_GUIDES).toHaveLength(30);
    expect(FIELD_GUIDES.reduce((total, entry) => total + entry.fields.length, 0)).toBe(332);
    expect(new Set(FIELD_GUIDES.map((entry) => entry.key)).size).toBe(FIELD_GUIDES.length);
    for (const entry of FIELD_GUIDES) {
      expect(['transport', 'wms', 'manufacturing', 'agents']).toContain(entry.domain);
      expect(entry.fields.length).toBeGreaterThan(4);
      expect(new Set(entry.fields.map((field) => field.key)).size).toBe(entry.fields.length);
      for (const field of entry.fields) {
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
          expect(field[key].trim(), `${entry.key}.${field.key}.${key}`).not.toBe('');
        if (field.defaultValue !== undefined) expect(field.defaultValue.trim()).not.toBe('');
      }
    }
  });
  it('cites real implementation files and existing application routes', () => {
    for (const entry of FIELD_GUIDES) {
      for (const path of entry.sources) expect(existsSync(resolve(root, path)), path).toBe(true);
      expect(
        existsSync(resolve(root, 'apps/web/src/routes/(app)', entry.href.slice(1), '+page.svelte')),
        entry.href,
      ).toBe(true);
    }
  });
  it('requires both a visible domain and every guide permission', () => {
    expect(visibleFieldGuides(access(['core.agents.read'], []))).toEqual([]);
    expect(visibleFieldGuides(access([]))).toEqual([]);
    expect(visibleFieldGuides(access(['core.agents.read'])).map((entry) => entry.key)).toEqual([
      'ai-workers',
    ]);
    expect(
      visibleFieldGuides(access(['transportation.orders.read'])).map((entry) => entry.key),
    ).toEqual(['transport-orders']);
    expect(
      visibleFieldGuides(access(['transportation.execution.read'])).map((entry) => entry.key),
    ).toEqual(['driver-mission']);
    expect(visibleFieldGuides(access(['core.agents.manage'])).map((entry) => entry.key)).toEqual([
      'ai-connection',
    ]);
  });
  it('searches accents, casing, words and technical keys without leaking invisible guides', () => {
    const quantity = guide('delivery-packages').fields.find(
      (field) => field.key === 'contents.quantity',
    )!;
    expect(matchesField(quantity, 'QUANTITE exact')).toBe(true);
    expect(matchesField(quantity, 'contents.quantity')).toBe(true);
    expect(matchesField(quantity, 'quantité carburant')).toBe(false);
    expect(matchesFieldGuide(guide('delivery-manifests'), 'etiquettes')).toBe(true);
    expect(
      visibleFieldGuides(access(['core.agents.read'])).filter((entry) =>
        matchesFieldGuide(entry, 'quantité du contenu'),
      ),
    ).toEqual([]);
  });
  it('requires cross-module activation independently of permission strings and keeps standalone guides available', () => {
    const permissions = ['manufacturing.read', 'wms.read', 'crm.read'];
    const standalone = visibleFieldGuides(
      access(permissions, ['manufacturing'], ['manufacturing']),
    );
    expect(standalone.map((entry) => entry.key)).toContain('manufacturing-resources');
    expect(standalone.map((entry) => entry.key)).not.toContain('manufacturing-mrp');
    const withWms = visibleFieldGuides(
      access(permissions, ['manufacturing'], ['manufacturing', 'wms']),
    );
    expect(withWms.map((entry) => entry.key)).toContain('manufacturing-mrp');
    expect(withWms.map((entry) => entry.key)).not.toContain('manufacturing-sales-units');
    expect(
      visibleFieldGuides(
        access(['manufacturing.read'], ['manufacturing'], ['manufacturing', 'wms']),
      ).map((entry) => entry.key),
    ).not.toContain('manufacturing-mrp');
    expect(
      visibleFieldGuides(
        access(permissions, ['manufacturing'], ['manufacturing', 'wms', 'crm']),
      ).map((entry) => entry.key),
    ).toContain('manufacturing-sales-units');
  });
  it('keeps exact package quantities and documentary proof separate from stock and external labels', () => {
    const quantity = guide('delivery-packages').fields.find(
      (field) => field.key === 'contents.quantity',
    )!;
    expect(quantity.validation).toContain('12 chiffres');
    expect(quantity.validation).toContain('3 après');
    expect(quantity.limits).toContain('Aucune somme');
    expect(guide('delivery-manifests').rules.join(' ')).toContain(
      '200 expéditions, 2 000 colis et 5 000 lignes',
    );
    expect(guide('delivery-manifests').rules.join(' ')).toContain(
      'ne sont pas des étiquettes d’un transporteur externe',
    );
    expect(guide('driver-mission').rules.join(' ')).toContain(
      'confirmation métier reste explicite',
    );
  });
  it('does not confuse authentication, runtime diagnostics, inference and spending authority', () => {
    const connection = guide('ai-connection');
    expect(connection.rules.join(' ')).toContain('contrôles distincts');
    expect(connection.fields.find((field) => field.key === 'runtimeStatus')!.limits).toContain(
      'ne prouve pas',
    );
    expect(connection.fields.find((field) => field.key === 'apiKey')!.effect).toContain('chiffrée');
    expect(
      guide('ai-workers').fields.find((field) => field.key === 'maxAmountPerAction')!.limits,
    ).toContain('pas un budget de tokens');
    expect(
      guide('ai-workers').fields.find((field) => field.key === 'autonomyLevel')!.defaultValue,
    ).toContain('PROPOSE');
  });
  it('gates examples by their specific modules and permissions', () => {
    const workers = guide('ai-workers');
    expect(visibleToolExamples(workers, access(['core.agents.read']))).toEqual([]);
    expect(
      visibleToolExamples(workers, access(['transportation.planning.read'], ['agents'], [])),
    ).toEqual([]);
    expect(visibleToolExamples(workers, access(['transportation.planning.read']))).toHaveLength(3);
    expect(visibleToolExamples(workers, access(['core.email.send'], ['agents'], []))).toHaveLength(
      1,
    );
    expect(visibleToolExamples(workers, access(['core.email.send']))[0].tools).toEqual([
      'draft_email',
    ]);
  });
  it('names only actual registry tools in usage examples', () => {
    const registry = ['tms', 'dispatch', 'email']
      .map((domain) =>
        readFileSync(resolve(root, `apps/api/src/core/agents/tools/${domain}.tools.ts`), 'utf8'),
      )
      .join('\n');
    for (const example of guide('ai-workers').examples!)
      for (const tool of example.tools) expect(registry, tool).toContain(tool);
  });
});
