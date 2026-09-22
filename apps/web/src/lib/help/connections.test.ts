import { describe, it, expect } from 'vitest';
import { MODULE_CONNECTIONS, BUSINESS_JOURNEYS, CONNECTION_KINDS } from './connections';
import { KNOWLEDGE_DETAILS, knowledgeArticles, matchesKnowledge } from './knowledge';
import type { NavDomain } from '$lib/modules/navigation';
import { SECTOR_ROADMAP } from './sector-roadmap';
import { MODULE_CATALOG } from '@pulsar/shared';
describe('Documented cross-module contracts', () => {
  it('uses known modules, unique identities and complete operational explanations', () => {
    expect(new Set(MODULE_CONNECTIONS.map((c) => c.id)).size).toBe(MODULE_CONNECTIONS.length);
    const covered = new Set(MODULE_CONNECTIONS.flatMap((c) => [c.from, c.to]));
    for (const key of Object.keys(KNOWLEDGE_DETAILS)) expect(covered.has(key), key).toBe(true);
    for (const c of MODULE_CONNECTIONS) {
      expect(KNOWLEDGE_DETAILS[c.from]).toBeDefined();
      expect(KNOWLEDGE_DETAILS[c.to]).toBeDefined();
      expect(CONNECTION_KINDS[c.kind]).toBeDefined();
      for (const text of [c.owner, c.requires, c.trigger, c.data, c.effect, c.noEffect, c.recovery])
        expect(text.length).toBeGreaterThan(25);
    }
  });
  it('distinguishes explicit reference mapping from transactional business actions', () => {
    expect(MODULE_CONNECTIONS.find((c) => c.id === 'services-billing')?.kind).toBe('operation');
    expect(MODULE_CONNECTIONS.find((c) => c.id === 'crm-catalog')?.kind).toBe('reference');
    expect(MODULE_CONNECTIONS.find((c) => c.id === 'services-wms')?.kind).toBe('operation');
    expect(MODULE_CONNECTIONS.find((c) => c.id === 'purchasing-wms')?.kind).toBe('operation');
  });
  it('documents each planned sector without advertising an available implementation', () => {
    expect(SECTOR_ROADMAP).toHaveLength(4);
    expect(new Set(SECTOR_ROADMAP.map((m) => m.key)).size).toBe(4);
    for (const m of SECTOR_ROADMAP) {
      expect(MODULE_CATALOG.find((entry) => String(entry.key) === m.key)?.available).not.toBe(true);
      expect(m.flow).toHaveLength(3);
      for (const text of [m.purpose, m.owner, m.links, m.tutorial, m.gate])
        expect(text.length).toBeGreaterThan(25);
    }
    expect(MODULE_CATALOG.find((m) => m.key === 'support')?.available).toBe(true);
    expect(MODULE_CATALOG.find((m) => m.key === 'quality')?.available).toBe(true);
    expect(MODULE_CATALOG.find((m) => m.key === 'hr')?.available).toBe(true);
    expect(MODULE_CONNECTIONS.find((c) => c.id === 'hr-settings')?.kind).toBe('reference');
    expect(MODULE_CONNECTIONS.find((c) => c.id === 'hr-services')?.kind).toBe('context');
    expect(MODULE_CONNECTIONS.find((c) => c.id === 'hr-manufacturing')?.kind).toBe('context');
    for (const c of MODULE_CONNECTIONS.filter((c) => c.from === 'quality'))
      expect(c.kind).toBe('context');
  });
  it('indexes deep connection content in the module search', () => {
    const articles = knowledgeArticles([
      {
        key: 'services',
        label: 'Services',
        home: '/services',
        prefixes: ['/services'],
        sections: [],
        icon: (() => null) as unknown as NavDomain['icon'],
      },
    ]);
    expect(matchesKnowledge(articles.find((a) => a.key === 'services')!, 'retour intégral')).toBe(
      true,
    );
    for (const j of BUSINESS_JOURNEYS) {
      expect(j.steps.length).toBeGreaterThan(3);
      for (const key of j.modules) expect(KNOWLEDGE_DETAILS[key]).toBeDefined();
    }
  });
});
