# Programme — Intégration plateforme, complétude des modules, comptabilité, IA

**Date:** 2026-06-24
**Statut:** roadmap auto-validée (autonomie déléguée — `pulsar-autonomie-execution`) ; exécution cycle par cycle
**Branche:** `crm-email-threads`

## Mandat (Sam, paraphrasé)

Migration + amélioration Billing pour le futur ; repasser tous les modules pour qu'ils
**communiquent et échangent des données** dans leurs workflows quand c'est logique métier ; rendre
ces échanges **configurables** dans les modules configurables ; auditer chaque module pour des
**fonctionnalités/pages manquantes** (ex: Billing → grand livre, inspiré d'autres systèmes) ; le
tout **bien intégré à l'IA**. Décider la logistique moi-même, pas de questions.

## Constat d'audit (2026-06-24)

- **Billing** est une facturation logistique (achat transporteur / vente client / freight audit),
  PAS un système comptable. Keystone manquant : **grand livre double-entrée** (plan comptable,
  écritures journal débit/crédit, balance), puis AR/AP, paiements, taxes, périodes, états financiers.
  La ligne de facture client est couplée au TMS (`CustomerInvoiceLine.transportOrderId` NOT NULL FK)
  → les factures issues d'une commande CRM n'ont pas de lignes (gap Cycle 6).
- **Moteur cross-module** solide : `DomainEventsService` (19 types d'events), `ReactionExecutorService`
  + `REACTION_CATALOG` (6 réactions whitelistées, idempotentes règle 38), policies événement→tâche
  (règle 27), Control Tower de flux (arc A), framework configurable (`module-settings` + custom
  fields, règles 35/36 — 8 modules branchés). 38 outils agent, 5+ presets de rôle.
- **15 arcs cross-module manquants** identifiés ; **gaps de pages/fonctionnalités** par module listés.

## Principe directeur

Rester **focus logistique + commerce** (pas un ERP comptable complet — l'audit chiffre ça à 13-20
sprints). Livrer un **grand livre v1 fondamental** (double-entrée auto-posté depuis les événements
billing) qui donne balance + base AR/AP + états simples, et **câbler les arcs cross-module à plus
forte valeur** via le moteur de réactions existant (whitelist + configurable), le tout exposé à l'IA
(outils + events + policies). Pas de refacto critique : extension par events/réactions/migrations
additives.

## Décomposition en cycles (ordre d'exécution)

### Cycle 7 — Billing : ligne libre + Grand Livre v1 (EN COURS, le plus concret)
Spec dédiée : `2026-06-24-billing-general-ledger-design.md`.
- **Migration ligne de facture libre** : `CustomerInvoiceLine.transportOrderId` nullable + champs
  ligne libre (`description`/`quantity`/`unitPrice`/`source`/`salesOrderLineId?`) → les factures
  issues d'une commande CRM (Cycle 6) s'itémisent enfin ; `createDraftFromSalesOrder` crée de vraies
  lignes ; `send()`/PDF les rend.
- **Grand Livre double-entrée v1** : `ChartOfAccount` (plan comptable seedé : AR, Revenue, Cash, AP,
  Expense, Tax…), `JournalEntry` + `JournalLine` (débit=crédit garanti, pur `@pulsar/shared`
  `isBalanced`), `LedgerService` qui **poste des écritures depuis les événements billing** (facture
  client approuvée → DR AR / CR Revenue ; paiement → DR Cash / CR AR ; facture transporteur approuvée
  → DR Expense / CR AP ; etc.), **balance / trial balance** calculée à la lecture, page
  `/billing/ledger` (plan + journal + balance), outils agent READ (`get_trial_balance`,
  `list_journal_entries`). Mappings de comptes **configurables** (module-settings). Postage automatique
  best-effort via le moteur d'événements/réactions (règle 38) ; idempotent.

### Cycle 8 — Tressage cross-module + configurabilité + IA
Spec dédiée à venir. Câbler les arcs manquants à plus forte valeur comme **réactions whitelistées**
(`REACTION_CATALOG`) déclenchées par des **events** existants/nouveaux, chacune **activable/désactivable
dans les settings du module** (configurable), et exposée à l'IA (event → policy → tâche agent quand
pertinent). Arcs prioritaires :
1. **Facture client impayée (overdue) → relance CRM** : cron émet `billing.invoice.overdue` → réaction
   crée une `CrmActivity` TASK de relance (+ policy tâche agent CRM).
2. **Commande de vente CRM confirmée → ordre de transport TMS** : `crm.sales_order.confirmed` →
   réaction crée un `TransportOrder` (si logistique pertinente) — configurable.
3. **Award RFP procurement → tarif TMS** : émettre `procurement.award.created` → réaction
   `create_rate_from_award` (le réglage `awardCreatesRateByDefault` existe déjà, brancher l'event).
4. **Détention yard → frais transporteur (Billing)** : `yard.visit.detention` → réaction ajoute une
   ligne de frais (configurable seuil/minutes).
5. (selon budget) BOL auto à la complétion, escalade variance comptage, etc.
Toutes idempotentes (règle 38), best-effort, single-hop anti-loop, gated par les modules requis +
un toggle de settings.

### Cycle 9 — Complétude par module (pages/fonctionnalités)
Spec(s) dédiée(s). Combler les gaps de plus forte valeur identifiés, ex :
- **Billing** : modèle `Payment` (paiements distincts du statut, partiels) + page paiements ;
  AR/AP aging (soldes clients/fournisseurs vieillis) à partir du grand livre.
- **CRM** : séquences email marketing / lead scoring (extension des campagnes existantes).
- **Procurement** : sourcing rules (auto-RFP par lane/fréquence).
- **TMS** : notification client ETA/POD + outils agent d'exception (retard).
- **Analytics** : tableaux de bord configurables par rôle + alertes seuil.
À prioriser selon la valeur et le budget de session ; chaque module = sa propre spec.

### Cycle 10+ — Intégrations externes (backlog, dépendances externes)
QuickBooks/Sage GL export, banques (rapprochement), Shopify, réseaux sociaux — **bloqués** sur des
identifiants/infra externes ; hors périmètre tant que non fournis.

## Conformité (transversale)
Règle 1 (tenant), 2 (state machines), 3 (enums shared mirror), 6 (audit), 8 (numéros via
SequencesService), 16/36 (snapshots figés, defaultCurrency), 27 (policies event→tâche), 35/36
(configurable), 37 (flow read-time), 38 (réactions whitelistées idempotentes via ModuleRef, anti-loop).
Chaque cycle : spec auto-validée → plan → subagent-driven (revue par tâche + revue finale) → e2e.

## Note honnête
Le grand livre v1 est une **fondation comptable**, pas un module comptable certifié (pas de
GAAP/IFRS, taxes complètes, états financiers signés, périodes verrouillées — listés en backlog).
Il donne la double-entrée, la balance, et la base AR/AP, et s'intègre à l'IA. La consolidation
comptable « sérieuse » resterait à exporter vers un logiciel comptable externe (pattern SaaS).
