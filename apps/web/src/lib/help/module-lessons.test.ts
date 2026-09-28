import { describe, expect, it } from 'vitest';
import { MODULE_LESSONS, LESSON_TITLES } from './module-lessons';
import { shouldStartTour } from './tours';
import { PARTY_INFORMATION_HELP, KNOWLEDGE_DETAILS } from './knowledge';
import { PAGE_GUIDES } from './catalog';
describe('parcours métier versionnés', () => {
  it('explique le runtime IA sans assimiler un contrôle local à une mission validée', () => {
    expect(MODULE_LESSONS.agents).toHaveLength(4);
    expect(MODULE_LESSONS.agents[0].text).toContain('aucun appel au modèle');
    expect(MODULE_LESSONS.agents[0].href).toBe('/agents');
    expect(KNOWLEDGE_DETAILS.agents.rules.join(' ')).toContain('refusée');
    expect(KNOWLEDGE_DETAILS.agents.limits.join(' ')).toContain('budget autorisé');
    expect(shouldStartTour({ version: 1, step: 0, status: 'COMPLETED' })).toBe(false);
  });
  it('sépare réalisation, acceptation et correction Services sans reset du tutoriel', () => {
    const lesson = MODULE_LESSONS.services.find(
      (s) => s.title === 'Recueillir l’acceptation des travaux',
    );
    expect(lesson?.href).toBe('/services/interventions');
    expect(lesson?.text).toContain('services.work.accept');
    expect(lesson?.text).toContain('pas d’une signature électronique');
    expect(KNOWLEDGE_DETAILS.services.rules.join(' ')).toContain('même demande');
    expect(KNOWLEDGE_DETAILS.services.rules.join(' ')).toContain(
      'Les autres interventions acceptées',
    );
    expect(shouldStartTour({ version: 1, step: 0, status: 'COMPLETED' })).toBe(false);
  });
  it('explique le dossier client sans confondre droits, liens directs et actions métier', () => {
    const step = MODULE_LESSONS.clients.find(
      (s) => s.title === 'Passer du client au dossier de travail',
    );
    expect(step?.target).toBe('[data-tour="party-workspace"]');
    expect(step?.text).toContain('Une facture masquée n’est pas une facture absente');
    expect(step?.text).toContain('n’active aucun module');
    expect(KNOWLEDGE_DETAILS.clients.rules.join(' ')).toContain('avant toute requête ou compteur');
    expect(KNOWLEDGE_DETAILS.clients.limits.join(' ')).toContain('pas une balance');
    expect(shouldStartTour({ version: 1, step: 0, status: 'COMPLETED' })).toBe(false);
  });
  it('sépare les dotations historiques groupées du plan futur non repris', () => {
    const step = MODULE_LESSONS.billing.find(
      (s) => s.title === 'Reprendre les dotations d’une immobilisation',
    );
    expect(step?.href).toBe('/billing/ledger-qualification');
    expect(step?.text).toContain('Les mois absents ne sont jamais ajoutés');
    expect(step?.text).toContain('qualifiées ensemble');
    expect(step?.text).toContain('le plan futur reste bloqué');
    expect(KNOWLEDGE_DETAILS.billing.rules.join(' ')).toContain('1200 périodes');
    expect(PAGE_GUIDES['/billing/fixed-assets'].connections).toContain('Reprise du journal');
    expect(PAGE_GUIDES['/billing/ledger-qualification'].steps.join(' ')).toContain(
      'Toutes les dotations',
    );
  });
  it('distingue payable accepté, anciennes lignes et écarts sans promettre une correction fiscale', () => {
    const step = MODULE_LESSONS.billing.find(
      (s) => s.title === 'Reprendre un montant transporteur accepté',
    );
    expect(step?.href).toBe('/billing/ledger-qualification');
    expect(step?.text).toContain('105 hors taxes comptabilisés');
    expect(step?.text).toContain('5, pas l’écart de lignes de 20');
    expect(step?.text).toContain('ACCEPT_INVOICED');
    expect(step?.text).toContain('absente ou ambiguë reste bloquante');
    expect(KNOWLEDGE_DETAILS.billing.rules.join(' ')).toContain(
      'acceptation tracée et payable déjà comptabilisé',
    );
    expect(KNOWLEDGE_DETAILS.billing.rules.join(' ')).not.toContain(
      'dont le payable accepté diffère des lignes attendues restent bloqués',
    );
    expect(PAGE_GUIDES['/billing/ledger-qualification'].steps.join(' ')).toContain(
      'aucun journal manquant',
    );
  });
  it('sépare le reste déclaré de la portion effectivement comptabilisée', () => {
    const step = MODULE_LESSONS.billing.find(
      (s) => s.title === 'Distinguer le reste non affecté d’un paiement',
    );
    expect(step?.text).toContain('2,67 hors journal');
    expect(step?.text).toContain('ni crédit client ni avance fournisseur');
    expect(step?.text).toContain('rapprochement bancaire reste bloqué');
    expect(step?.text).toContain('même demande conservée');
    expect(PAGE_GUIDES['/billing/ledger'].caution).toContain('le reste demeure hors journal');
    expect(PAGE_GUIDES['/billing/ledger'].caution).toContain('les factures cohérentes');
    expect(PAGE_GUIDES['/billing/ledger'].caution).not.toContain('Factures et anciens actifs');
  });
  it('explique les factures, taxes figées et avoirs à devise connue', () => {
    const step = MODULE_LESSONS.billing.find(
      (s) => s.title === 'Reprendre une facture avec ses avoirs',
    );
    expect(step?.href).toBe('/billing/ledger-qualification');
    expect(step?.text).toContain('taxes figées');
    expect(step?.text).toContain('bloque le retrait isolé');
    expect(step?.text).toContain('ne crée jamais une écriture manquante');
  });
  it('explique la portée groupée et les limites de reprise des paiements', () => {
    const step = MODULE_LESSONS.billing.find(
      (s) => s.title === 'Reprendre un paiement avec sa contrepassation',
    );
    expect(step?.href).toBe('/billing/ledger-qualification');
    expect(step?.text).toContain('comptes originaux');
    expect(step?.text).toContain('retirez d’abord tout rapprochement bancaire');
    expect(step?.text).toContain('dossiers incohérents restent bloqués');
  });
  it('explique la qualification séparée et le retrait sans contrepassation', () => {
    const step = MODULE_LESSONS.billing.find((s) => s.href === '/billing/ledger-qualification');
    expect(step?.target).toBe('[data-tour="ledger-qualification"]');
    expect(step?.text).toContain('originale reste inchangée');
    expect(step?.text).toContain('sans contrepassation');
    expect(step?.text).toContain('actuellement confirmée');
  });
  it('distingue le plan figé, la dotation et le retrait non comptable', () => {
    const step = MODULE_LESSONS.billing.find((s) => s.href === '/billing/fixed-assets');
    expect(step?.target).toBe('[data-tour="fixed-assets-register"]');
    expect(step?.text).toContain('paramètres deviennent immuables');
    expect(step?.text).toContain('fin civile UTC');
    expect(step?.text).toContain('ne comptabilise aucune cession');
    expect(step?.text).toContain('demande conservée');
  });
  it('explique le profil comme cible et les budgets sans conversion', () => {
    const step = MODULE_LESSONS.billing.find((s) => s.href === '/billing/accounting-profile');
    expect(step?.text).toContain('aucune comptabilité officielle');
    expect(step?.text).toContain('période est figée');
    expect(step?.text).toContain('même demande conservée');
  });
  it('explique les devises sans prétendre une consolidation ou une balance historique', () => {
    const step = MODULE_LESSONS.billing.find((s) => s.href === '/billing/reports');
    expect(step?.target).toBe('[data-tour="ledger-currency"]');
    expect(step?.text).toContain('sans additionner CAD et USD');
    expect(step?.text).toContain('la même écriture');
    expect(step?.text).toContain('Pas encore de change ou clôture');
  });
  it('explique la prévision fournisseur sans inventer une dette ou un paiement', () => {
    const s = MODULE_LESSONS.billing.find((s) => s.href === '/billing/supplier-schedules');
    expect(s?.text).toContain('exactement le reste');
    expect(s?.text).toContain('À revoir');
    expect(s?.text).toContain('ne comptabilise aucune dette');
    expect(s?.target).toBe('[data-tour="supplier-schedule-register"]');
  });
  it('distingue la consolidation fournisseur d’une dette et de ses filtres', () => {
    const s = MODULE_LESSONS.billing.find((s) => s.href === '/billing/suppliers');
    expect(s?.text).toContain('tout l’historique qualifié');
    expect(s?.text).toContain('n’est pas une dette à payer');
    expect(s?.text).toContain('désactivé');
  });
  it('distingue la facture fournisseur documentaire du paiement et du stock', () => {
    expect(
      MODULE_LESSONS.billing.find((s) => s.title === 'Réduire une facture avec un avoir reçu')
        ?.text,
    ).toContain('Aucun stock, remboursement');
    const step = MODULE_LESSONS.billing.find((s) => s.href === '/billing/supplier-invoices');
    expect(step?.text).toContain('pas payée ou comptabilisée');
    expect(step?.text).toContain('même demande conservée');
  });
  it('explique la traçabilité bornée sans assimiler préparation et livraison', () => {
    expect(MODULE_LESSONS.wms[5].text).toContain('Traçabilité du lot');
    expect(MODULE_LESSONS.wms[5].text).toContain('ne prouve pas une livraison');
    expect(MODULE_LESSONS.manufacturing[4].text).toContain('contrepassations sont exclues');
  });
  it('enseigne une déclaration multi-lots sans inventer une généalogie par pièce', () => {
    expect(MODULE_LESSONS.manufacturing).toHaveLength(6);
    expect(MODULE_LESSONS.manufacturing[2].text).toContain('Ajouter un lot / emplacement');
    expect(MODULE_LESSONS.manufacturing[3].text).toContain('Un lot de sortie par déclaration');
    expect(MODULE_LESSONS.manufacturing[4].text).toContain('aucune consommation antérieure');
    expect(MODULE_LESSONS.manufacturing[5].text).toContain('OF terminé : correction refusée');
  });
  it('explique les lots Services, les retours et les avoirs sans choix implicite', () => {
    const step = MODULE_LESSONS.services.find(
      (s) => s.title === 'Sortir et retourner les bonnes pièces',
    );
    expect(step?.href).toBe('/services/interventions');
    expect(step?.text).toContain('même lot et emplacement');
    expect(step?.text).toContain('avoir validé');
    expect(step?.text).toContain('sans changer sa clé ni son lot');
  });
  it('explique le parcours lot sans promettre allocation ni généalogie', () => {
    expect(MODULE_LESSONS.wms).toHaveLength(8);
    expect(MODULE_LESSONS.wms[7].href).toBe('/wms/stock-exits');
    expect(MODULE_LESSONS.wms[7].text).toContain('Le brouillon ne réserve rien');
    expect(MODULE_LESSONS.wms[7].text).toContain('cumuls reçus, acceptés et refusés');
    expect(MODULE_LESSONS.wms[7].text).toContain('une acceptation ne crée pas d’avoir');
    expect(MODULE_LESSONS.purchasing[6].text).toContain('Suivi chez le fournisseur');
    expect(MODULE_LESSONS.wms[6].text).toContain('ne contourne automatiquement le blocage');
    expect(MODULE_LESSONS.wms[6].text).toContain('Préparations à revoir');
    expect(MODULE_LESSONS.quality[2].text).toContain('rattacher après coup');
    const text = MODULE_LESSONS.wms.map((s) => s.text).join(' ');
    expect(text).toContain('Ce choix est définitif');
    expect(text).toContain('pas une règle FEFO automatique');
    expect(text).toContain('déclarations atelier');
    expect(text).toContain('zéro compris');
    expect(text).toContain('invalide l’instantané');
  });
  it('relie la fiche article aux conditions choisies sans conversion implicite', () => {
    expect(MODULE_LESSONS.catalog).toHaveLength(3);
    expect(MODULE_LESSONS.catalog.every((step) => step.href === '/catalog')).toBe(true);
    expect(MODULE_LESSONS.catalog.map((step) => step.text).join(' ')).toContain(
      'Les dimensions descriptives ne servent jamais de conversion',
    );
    expect(MODULE_LESSONS.purchasing.map((step) => step.text).join(' ')).toContain(
      'toujours au prix par EA',
    );
    expect(MODULE_LESSONS.purchasing[5].text).toContain('le scan ne remplit ni quantité ni stock');
  });
  it('explique les nouvelles fiches sans les présenter comme des règles métier exécutables', () => {
    for (const key of [
      'clients',
      'transport',
      'crm',
      'catalog',
      'services',
      'support',
      'purchasing',
      'billing',
      'customer-portal',
    ])
      expect(PARTY_INFORMATION_HELP[key]).toContain('Fiche entreprise');
    expect(PARTY_INFORMATION_HELP.purchasing).toContain('Achats seul');
    expect(PARTY_INFORMATION_HELP.billing).toContain('aucun taux de taxe');
    expect(MODULE_LESSONS.clients[1].text).toContain('confirmer avec un motif');
  });
  it('publie des séquences adaptées plutôt qu’un gabarit fixe', () => {
    expect(MODULE_LESSONS.hr).toHaveLength(7);
    expect(MODULE_LESSONS.quality).toHaveLength(6);
    expect(MODULE_LESSONS.support).toHaveLength(5);
    expect(MODULE_LESSONS.purchasing).toHaveLength(7);
    expect(MODULE_LESSONS.purchasing.map((s) => s.text).join(' ')).toContain(
      'pas de votre entrepôt de réception',
    );
    expect(MODULE_LESSONS.billing).toHaveLength(20);
    expect(MODULE_LESSONS.transport).toHaveLength(6);
    expect(MODULE_LESSONS.crm).toHaveLength(7);
    expect(MODULE_LESSONS.crm.map((s) => s.text).join(' ')).toContain(
      'Vérifier le statut enregistré',
    );
    expect(MODULE_LESSONS.transport.map((s) => s.text).join(' ')).toContain(
      'coordonnées commerciales privées',
    );
    expect(MODULE_LESSONS.billing.map((s) => s.text).join(' ')).toContain(
      'simulation = aucun courriel',
    );
    expect(MODULE_LESSONS.billing.map((s) => s.text).join(' ')).toContain(
      'Document et envoi client',
    );
    const titles = Object.values(MODULE_LESSONS).flatMap((x) => x.map((s) => s.title));
    expect(new Set(titles).size).toBe(titles.length);
    for (const steps of Object.values(MODULE_LESSONS))
      for (const s of steps) expect(s.text.length).toBeGreaterThan(80);
    expect(LESSON_TITLES.services[2]).toContain('temps');
  });
  it('présente seulement les modules encore jamais ouverts, quelle que soit la version', () => {
    expect(shouldStartTour()).toBe(true);
    for (const version of [1, 2]) {
      for (const status of ['COMPLETED', 'SKIPPED', 'IN_PROGRESS'] as const) {
        expect(shouldStartTour({ version, step: 0, status })).toBe(false);
      }
    }
  });
  it('explique les usages du carnet dans chaque parcours consommateur sans ajouter un tutoriel générique', () => {
    for (const key of ['clients', 'services', 'billing', 'transport', 'crm', 'purchasing'])
      expect(MODULE_LESSONS[key].map((s) => s.text).join(' ')).toContain('Documents liés');
  });
});
