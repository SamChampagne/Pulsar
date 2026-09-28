import { describe, it, expect } from 'vitest';
import { MODULE_CONNECTIONS, BUSINESS_JOURNEYS, CONNECTION_KINDS } from './connections';
import { KNOWLEDGE_DETAILS, knowledgeArticles, matchesKnowledge } from './knowledge';
import type { NavDomain } from '$lib/modules/navigation';
import { SECTOR_ROADMAP } from './sector-roadmap';
import { MODULE_CATALOG } from '@pulsar/shared';
describe('Documented cross-module contracts', () => {
  it('distinguishes Telnyx acceptance from delivery and keeps automated messaging out of v1', () => {
    expect(KNOWLEDGE_DETAILS.connect.rules.join(' ')).toContain('sans variable serveur');
    expect(KNOWLEDGE_DETAILS.connect.limits.join(' ')).toContain('START ne le réactive pas');
    expect(KNOWLEDGE_DETAILS.emails.rules.join(' ')).toContain('mode réel dans l’application');
    expect(KNOWLEDGE_DETAILS.connect.rules.join(' ')).toContain(
      'jamais de nouvel envoi automatique',
    );
    expect(KNOWLEDGE_DETAILS.connect.limits.join(' ')).toContain('pas livré');
    expect(KNOWLEDGE_DETAILS.emails.rules.join(' ')).toContain('pas à une interdiction globale');
    expect(KNOWLEDGE_DETAILS.emails.rules.join(' ')).toContain('images distantes bloqués');
  });
  it('distinguishes pilot observations from real acceptance without activating modules', () => {
    expect(KNOWLEDGE_DETAILS.settings.rules.join(' ')).toContain('Le choix ne change aucun module');
    expect(KNOWLEDGE_DETAILS.settings.rules.join(' ')).toContain('pas une certification');
    expect(KNOWLEDGE_DETAILS.settings.limits.join(' ')).toContain('APS est requis seulement');
    expect(KNOWLEDGE_DETAILS.settings.limits.join(' ')).toContain('aucune preuve externe');
  });
  it('keeps supplier credit, physical return and payment separate', () => {
    const c = MODULE_CONNECTIONS.find((c) => c.id === 'supplier-return-credit')!;
    expect(c.kind).toBe('context');
    expect(c.noEffect).toContain('Aucun montant calculé');
    expect(c.recovery).toContain('jamais une nouvelle clé');
    expect(KNOWLEDGE_DETAILS.billing.rules.join(' ')).toContain('reste créditable');
    expect(KNOWLEDGE_DETAILS.billing.rules.join(' ')).toContain('billing.supplier-credits.manage');
  });
  it('explains net parts, draft correction and the separate credit/physical-return workflow', () => {
    const services = KNOWLEDGE_DETAILS.services;
    expect(services.rules.join(' ')).toContain('2,75 à facturer');
    expect(services.rules.join(' ')).toContain('supprimez le brouillon');
    expect(services.rules.join(' ')).toContain('billing.credit-notes.approve');
    expect(KNOWLEDGE_DETAILS.billing.rules.join(' ')).toContain('Un avoir n’est pas un paiement');
    expect(KNOWLEDGE_DETAILS.billing.rules.join(' ')).toContain('billing.credit-notes.send');
    expect(KNOWLEDGE_DETAILS.billing.rules.join(' ')).toContain('jamais une relance automatique');
    expect(KNOWLEDGE_DETAILS.billing.limits.join(' ')).toContain('pas de remboursement bancaire');
    expect(MODULE_CONNECTIONS.find((c) => c.id === 'billing-credit-email')?.noEffect).toContain(
      'Simuler ne contacte pas le client',
    );
    expect(services.limits.join(' ')).not.toContain('retours de pièces sont intégraux');
    expect(MODULE_CONNECTIONS.find((c) => c.id === 'services-wms')?.effect).toContain('partiel');
    expect(MODULE_CONNECTIONS.find((c) => c.id === 'services-billing')?.effect).toContain(
      'sélection périmée',
    );
  });
  it('explains live connector tests, suspended retries and backup qualification limits', () => {
    expect(KNOWLEDGE_DETAILS.connect.rules.join(' ')).toContain('redirections HTTP');
    expect(KNOWLEDGE_DETAILS.connect.rules.join(' ')).toContain('livraisons encore en attente');
    expect(KNOWLEDGE_DETAILS.connect.limits.join(' ')).toContain('Simulation');
    expect(KNOWLEDGE_DETAILS.connect.limits.join(' ')).toContain('X-Pulsar-Delivery');
    expect(KNOWLEDGE_DETAILS.settings.rules.join(' ')).toContain('restauration');
    expect(KNOWLEDGE_DETAILS.settings.limits.join(' ')).toContain('qualification Docker locale');
  });
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
      expect(c.kind).toBe(c.id === 'quality-lot-release' ? 'operation' : 'context');
    const lotRelease = MODULE_CONNECTIONS.find((c) => c.id === 'quality-lot-release')!;
    expect(lotRelease.noEffect).toContain('libération automatique');
    expect(lotRelease.requires).toContain('WMS seul');
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
    expect(matchesKnowledge(articles.find((a) => a.key === 'services')!, 'dossier 360°')).toBe(
      true,
    );
    for (const j of BUSINESS_JOURNEYS) {
      expect(j.steps.length).toBeGreaterThan(3);
      for (const key of j.modules) expect(KNOWLEDGE_DETAILS[key]).toBeDefined();
    }
  });
});
