# Arc E — Réactions cross-module (suite) + Procurement configurable

> Spec de design. Poursuit l'arc « plateforme tressée » après arc B (réactions) / arc C-D
> (configurabilité). Deux parties indépendantes décidées avec Sam le 2026-06-22 :
> **(1)** trois nouvelles réactions `RUN_ACTION` déterministes ; **(2)** rendre le module
> **Procurement** configurable (champs perso + préfixe), en rejouant le patron rodé.

## 0. Intention & invariants

- **Partie 1** étend le catalogue `REACTION_CATALOG` (`@pulsar/shared/automation/reactions.ts`)
  et le `switch` de `ReactionExecutorService`. Chaque réaction : déclencheur = un `DomainEvent`
  déjà émis ; handler = réutilise un service métier existant ; **déterministe + idempotent**
  (dédup framework sur `(tenantId,eventId,ruleId)` + idempotence logique du handler) ; best-effort
  (échec → `ReactionExecution FAILED`, jamais bloquant). Règle 38 préservée : aucun effet externe
  (email/appel tiers) dans un handler — ceux-là restent gouvernés par les agents.
- **Partie 2** rejoue le patron TMS/Billing/WMS/Yard/Fleet : `CustomFieldsService` core générique,
  contrôleur `procurement/custom-fields`, colonnes `customData Json?`, `CustomFieldInputs`/
  `CustomFieldsEditor` web, préfixe via `MODULE_SETTINGS_CATALOG` + `SequencesService.OVERRIDABLE`.
- **Invariant directeur** : défauts = comportement actuel. Aucune règle de réaction nouvelle n'est
  **seedée** (les 3 réactions sont *disponibles* dans le catalogue, l'opérateur les active via
  l'éditeur d'automation) ; aucun champ perso ni préfixe modifié par défaut.
- Conformité CLAUDE.md : règles 1 (tenant), 2 (state machines — transitions via `canTransition*`),
  6 (audit), 8 (numéros via SequencesService, compteur sur la clé), 35 (validate avant persist),
  36 (contrôleur gated par module), 38 (réactions déterministes, anti-loop single-hop).

## 1. Hors périmètre (YAGNI)

- **carrier-portal / connect configurables** : pas d'entité-donnée tenant pertinente (liens,
  batches d'import) ; ils gardent leurs réglages de process existants. Hors périmètre.
- **Réactions écartées** : `open_freight_audit` (l'`IncomingCarrierInvoice` EST déjà l'intake du
  freight audit → redondant/risque de boucle) ; `putaway_pick` sur réception (choix de bin =
  politique non déterministe, pas adapté à une réaction). Réintroductibles plus tard si un besoin
  déterministe émerge.
- **Pas de nouveau type de champ perso** ni format de numéro autre que `PRÉFIXE-NNNNNN`.

---

## Partie 1 — Trois réactions `RUN_ACTION`

Ajouts au `REACTION_CATALOG` + handlers dans `ReactionExecutorService` (case par clé). Chaque
handler résout ses services via `ModuleRef.get()` + lazy `require()` (règle 38 : `AutomationModule`
n'importe jamais statiquement les modules métier).

| Clé | Déclencheur (event) | argKeys | Effet (déterministe, idempotent) | Service réutilisé |
| --- | --- | --- | --- | --- |
| `open_maintenance_order` | `fleet.maintenance.due` | `assetKind` (`'vehicle'`\|`'trailer'`), `assetId`, `scheduleId`, `name` | Ouvre un `MaintenanceOrder` PREVENTIVE pour l'asset dû **si aucun WO ouvert (statut ∉ {COMPLETED, CANCELLED}) n'existe déjà pour cet asset** (le `CreateMaintenanceOrderDto` n'accepte pas `scheduleId` → dédup sur asset+statut-ouvert). `description` = `name` du schedule. Passe par `MaintenanceService.create` (asset → MAINTENANCE via `canTransitionAsset`, règle 32). | `MaintenanceService.create(tenantId, userId, dto)` (module `fleet`) |
| `assign_dock_appointment` | `yard.visit-checked-in` | `visitId` | Si la visite a un `appointmentId` dont le `DockAppointment.spotId` est renseigné, et que la visite n'a **pas encore** de `spotId`, affecte la visite à ce spot via la méthode **publique** `VisitsService.assign(tenantId, userId, visitId, { spotId })` (qui enveloppe `assignToSpot` privé dans une tx + écrit `YardMove`, règle 34) ; **no-op si la visite a déjà un spot, si l'appointment n'a pas de spot, ou si le spot est occupé** (respecte `spotConflictPolicy`). Lien concret : `YardVisit.appointmentId → DockAppointment.spotId`. | `VisitsService.assign` (module `yard`) |
| `close_delivered_transport_order` | `load.completed` | `loadId` | La complétion du load a déjà avancé ses ordres entièrement livrés à `COMPLETED` (`loads.service.ts:586`). La réaction transitionne ces ordres `COMPLETED → CLOSED` via `TransportOrdersService.close` (state machine, seul `COMPLETED→CLOSED` autorisé — règle 2) ; **filtre sur `status === COMPLETED`, no-op sinon** (donc idempotent : un ordre déjà CLOSED est ignoré). Trouve les ordres via les shipments du load (`shipment.loadId → transportOrderId` distincts). | `TransportOrdersService.close` (module `transportation`) |

### 1.1 Émetteurs des déclencheurs

- `fleet.maintenance-due` : déjà émis par `maintenance-schedules.service.ts:277` — vérifier que le
  payload porte `assetType`/`assetId`/`scheduleId` ; sinon enrichir l'`emit` (best-effort, non
  bloquant) au moment de l'implémentation.
- `yard.visit-checked-in` : déjà émis (policy palier 12). Vérifier le payload `visitId`.
- `load.completed` : déjà émis (arc B). Payload `loadId`.

### 1.2 Idempotence & anti-loop

La dédup framework (`ReactionExecution` unique `(tenantId,eventId,ruleId)`) couvre la re-livraison.
Chaque handler ajoute son idempotence **logique** (WO ouvert déjà présent / visite déjà affectée /
ordre déjà CLOSED) pour rester sûr même si la même condition métier se répète sur un autre event.
Anti-loop single-hop inchangé : un `DomainEvent` portant `reactionRuleId` n'est pas ré-évalué par
des règles `RUN_ACTION`.

### 1.3 Tests Partie 1

- Unit `@pulsar/shared` : `REACTION_CATALOG` contient les 3 clés (label/module/requiredModules/argKeys) ;
  `reactionByKey` les résout.
- e2e (réutilise l'infra `cross-module-automation`) : créer une règle `RUN_ACTION` par réaction,
  émettre/déclencher l'event réel, `processPending`, vérifier l'effet **et** l'idempotence (2ᵉ
  déclenchement = no-op, pas de doublon) + `ReactionExecution EXECUTED`. Cas module désactivé = no-op.

---

## Partie 2 — Procurement configurable

### 2.1 Champs personnalisés — RFP seulement (découverte de scope)

**Recadrage** : à l'inspection du code, seul le **RFP** possède un formulaire interne de
création/édition (`POST /procurement/rfps`, `PATCH /procurement/rfps/:id`). Les **Bid** sont créés
**exclusivement via le portail public** transporteur (`POST /public/rfp-invites/:token/bids`) et les
**Award** sont **générés** par l'action `POST /rfps/:id/award` — aucun des deux n'a de formulaire
interne où saisir des champs perso. Y attacher des définitions de champs serait un knob **sans
surface de saisie** (anti-pattern « no consumer »). Donc **v1 = champs perso sur `RFP` uniquement** ;
Bid/Award reportés (réintroductibles quand/si un point de saisie interne existe).

`CustomFieldEntity` (`@pulsar/shared`, miroir `schema.prisma` règle 3) += `RFP`. Colonne
`customData Json?` sur `Rfp`. Contrôleur `procurement/custom-fields` (copie du patron,
`@RequireModule(MODULE_KEYS.PROCUREMENT)` + `core.modules.read|manage` +
`@Audit('custom-field-definition', UPDATE)`). `createRfp`/`updateRfp` acceptent `customData?`
validé via `validateValues('procurement', tenantId, CustomFieldEntity.RFP, data, { partial })`
avant persist (règle 35). Projections GET du RFP incluent `customData`.

### 2.2 Règle de processus — préfixe RFP

Le catalogue `procurement` (déjà présent : `bidUniqueness`, `awardCreatesRateByDefault`) gagne
`documentPrefixRfp` (string `^[A-Z0-9]{1,6}$`, défaut `RFP`). Entrée `OVERRIDABLE`
`rfp → { module: 'procurement', settingKey: 'documentPrefixRfp' }` dans `SequencesService`
(compteur indexé sur la clé `rfp`, jamais le préfixe — règle 8). Défaut = `RFP` (= valeur statique
actuelle, aucun changement observable).

### 2.3 Web

- `CustomFieldsEditor` : branche `procurement` → entité RFP (une seule, libellé FR « RFP »).
- Page config `/settings/modules/procurement` (route `[key]` générique déjà existante) : la section
  `ModuleSettings` rend automatiquement le préfixe ; ajouter la branche `{:else if key==='procurement'}`
  pour `CustomFieldsEditor`. Le lien nav « Configuration » procurement existe déjà (`navigation.ts`).
- `CustomFieldInputs` inséré sur le formulaire create/edit RFP — patron `transport-orders`
  (fetch `/procurement/custom-fields?entityType=RFP`, `.catch(()=>[])`, `{#if>0}`, customData omis si vide).

### 2.4 Tests Partie 2

- e2e `procurement-configurable` : préfixe `documentPrefixRfp='RFQ'` → prochain n° RFP `RFQ-…` +
  compteur monotone ; champ perso SELECT requis sur `RFP` → 400 manquant / 400 hors-options /
  201+`customData` dans la projection ; isolation tenant.

---

## 3. Migration & permissions

- **1 migration** : 1 valeur d'enum `CustomFieldEntity` (`RFP`) + 1 colonne `customData Json?`
  (`Rfp`). Aucun nouveau statut (règle 2).
- **Aucune nouvelle permission** : réactions = aucune (catalogue + executor) ; config procurement
  sous `core.modules.read|manage` + `procurement.*` existants.

---

## 4. Découpage d'implémentation (aperçu — détaillé dans le plan)

1. `@pulsar/shared` : 3 réactions au catalogue + tests ; `CustomFieldEntity` += `RFP` ;
   `documentPrefixRfp` au catalogue procurement. Rebuild shared.
2. `packages/database` : 1 migration (enum `RFP` + colonne `customData` sur `Rfp`), regen.
3. API réactions : 3 handlers dans `ReactionExecutorService` (résolution lazy via ModuleRef) ;
   le payload `fleet.maintenance.due` porte déjà `assetKind`/`assetId`/`scheduleId`/`name` ;
   `OVERRIDABLE rfp → { procurement, documentPrefixRfp }`.
4. API procurement : contrôleur `procurement/custom-fields` + customData sur `createRfp`/`updateRfp`
   + projection GET RFP.
5. Web : branche éditeur procurement (RFP) + `CustomFieldInputs` sur le formulaire RFP.
6. e2e : 3 réactions (effet + idempotence) + procurement configurable ; + vérif navigateur.
