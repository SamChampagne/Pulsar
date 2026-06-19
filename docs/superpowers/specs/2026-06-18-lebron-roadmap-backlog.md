# Backlog — analyse Lebron (roadmap d'implémentation autonome)

Source : analyse fournie par Sam le 2026-06-18 (« implémente tout ce qui était dedans, morceau
par morceau, prends les décisions toi-même, en subagents »). Branche de travail :
`analytics-control-tower` (puis branches/PR par chantier au besoin).

Ce fichier est le **plan maître**. Chaque morceau a son propre spec + exécution subagents.
État : `todo` / `wip` / `done`.

## Chantier 1 — Control Tower / Analytics
- [done] **M1 — Module analytics + Control Tower opérationnelle (MVP)** : activer le module,
  permission `analytics.read`, `GET /analytics/control-tower?days=` (calculs à la lecture),
  panneau « Attention » (loads en retard, litiges freight-audit, assets OUT_OF_SERVICE, dock
  appointments à risque, pick COMPLETED sans dispatch, actions agents en attente) + KPI en-tête
  (loads en transit/retard, OTIF, coût moyen/load, $ récupérés, dispo flotte, actions en
  attente, tâches ouvertes). Page web + nav/universe. Réutilise le carrier scorecard existant.
- [todo] **M2 — Scorecards & profitabilité** : carrier scorecard enrichi, lane profitability,
  customer profitability, fleet uptime, yard congestion, warehouse readiness, exception heatmap,
  agent ROI (économies, tâches résolues, taux d'approbation, breaker trips, temps moyen).

## Chantier 2 — Workbench v2 (centre de résolution)
- [done] **ExceptionCase** : cas (statut, SLA, owner humain/agent, events liés, actions
  proposées, notes, timeline, documents, impact financier).
- [done] **Playbooks** : load en retard, tender expiré, facture carrier avec écart, asset en
  maintenance, pick terminé non dispatché, dock appointment late, inventory below min.
- [done] **SLA / priorité** : critique après X min, escalade auto, assignation auto agent,
  notification humain si non résolu.
- [done] **Kanban opérationnel** : Nouveau / En analyse / Action proposée / En attente humain /
  Résolu.

## Chantier 3 — Outils agents par module
- [done] **Agent Fleet** : list_assets, get_vehicle, get_trailer, list_maintenance_due,
  create_maintenance_order, mark_asset_out_of_service, upload_compliance_document,
  flag_expiring_compliance, suggest_asset_replacement.
- [done] **Agent Yard** : list_yard_visits, get_yard_board, assign_yard_spot, move_trailer,
  create_dock_appointment, mark_arrived, mark_departed, flag_detention.
- [done] **Agent WMS** : list_low_stock_items, create_replenishment_task, get_pick_order,
  prioritize_pick_orders, flag_inventory_variance, create_cycle_count,
  release_shipment_when_pick_complete.
  (Tous via le registre `core/agents/tool-registry.ts` — règle 21/22 : tier/permission/module/
  zod/handler ; MUTATING/SENSITIVE → ProposedAction.)
  **Note** : 19 outils livrés. 5 DIFFÉRÉS (pas de service adossé / advisory / dérivé) —
  `upload_compliance_document` (binaire impossible en MCP, attend l'ingestion C4),
  `suggest_asset_replacement` (advisory), `create_replenishment_task`, `prioritize_pick_orders`,
  `release_shipment_when_pick_complete` (statut dérivé, rule 33 v2). Détails : spec C3.

## Chantier 4 — Connect / Ingestion
- [done] **Inbox Connect** : page de tout ce qui entre (email, PDF facture, CSV, webhook, EDI,
  erreurs de mapping, doc non reconnu).
- [done] **Objets canoniques** : InboundMessage, ParsedDocument, IntegrationRun,
  MappingException, ImportBatch.
- [done] **Ingestion PDF** : facture transporteur → IncomingCarrierInvoice ; POD → document ;
  BOL → document ; rate sheet → rates/lanes/accessorials.
- [done] **CSV importer** : customers, locations, carriers, rates, items, inventory,
  vehicles/trailers, transport orders.

## Chantier 5 — Agent Dispatcher / Exceptions (agent phare)  [SKIPPED par Sam 2026-06-18 — on passe aux modules B→J]
- [skip] Sur événement (stop delayed, tender declined/expired, shipment ready from WMS, yard
  appointment late, asset unavailable, carrier invoice mismatch) : ouvre/analyse un cas et
  propose (re-tender, notifier client, déplacer dock appointment, réassigner asset, recalculer
  ETA, créer tâche humaine, escalader). UI cas + propositions [Approuver]/[Modifier]/[Rejeter].

## Modules additionnels (priorité moindre, après les chantiers)
- [done] **B. Procurement / Bid Board** : RFP lanes, spot bids, award carrier, routing guide.
- [done] **C. Carrier Portal** : tenders reçus, accept/refuse, upload facture/POD, paiements,
  litiges, tracking, profil, conformité.
- [done] **D. Driver Mobile PWA** : stops du jour, arrivée/départ, POD/photo, signature,
  exception/damage, position, BOL, notes.
- [done] **E. Customer Portal v2** : créer ordre, templates récurrents, tracking, docs, POD,
  factures, demandes de changement, chat par shipment, branding.
- [phase-1 done] **F. Planning Board** : shipments non assignés, loads ouverts, assets/drivers dispo,
  warnings capacité, drag & drop shipment→load — LIVRÉ (endpoint agrégation `planning-board` +
  page `/planning` réutilisant assign/remove). DIFFÉRÉ F-phase-2 : plan proposal agent, scénario A/B.
  Spec : `docs/superpowers/specs/2026-06-19-module-f-planning-board.md`.
- [phase-1 done] **G. Rate Studio** : simulation sans load, « why this rate? », compare carriers —
  LIVRÉ (POST `rating/simulate` réutilisant le moteur, page `/rate-studio`). lane builder/accessorial/
  fuel = pages existantes liées depuis le hub. DIFFÉRÉ G-phase-2 : import CSV rates/lanes/accessorials,
  audit-trail des changements de tarifs, test-load. Spec : `docs/superpowers/specs/2026-06-19-module-g-rate-studio.md`.
- [phase-1 done] **H. Document Center** : vue unifiée de tous les documents (facettes par type,
  filtres fileName/date, download) + panneau conformité expirante — LIVRÉ (GET `/documents/center`,
  app desk `/documents`). DIFFÉRÉ H-phase-2 : statut missing/received/verified/rejected (+migration),
  OCR/extraction, agent review, détection docs manquants, liens publics dédiés.
  Spec : `docs/superpowers/specs/2026-06-19-module-h-document-center.md`.
- [todo] **I. Rules / Policy Builder** : interface « Quand … Alors … » configurable (events→
  actions), au-dessus du moteur policies existant (`@pulsar/shared/operating`).
- [todo] **J. Onboarding / Demo tenant / Sample data** : wizard tenant (modules, données, users,
  LLM, email/API), sample data, reset demo, scénarios de démo.

## Principe d'exécution
Chaque morceau : spec court → tâches → subagents (implémenteur + reviewer) → commit. Décisions
prises de façon autonome ; on ne s'arrête que sur blocage réel ou fork stratégique. Respect strict
des règles CLAUDE.md (tenant isolation, state machines, enums shared, permissions/modules,
audit, DocumentsService, registre d'outils agents, calculs à la lecture pour les KPI).
