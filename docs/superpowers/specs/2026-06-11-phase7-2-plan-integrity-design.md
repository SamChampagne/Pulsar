# Phase 7.2 — Intégrité du plan : design

> Validé le 2026-06-11. Deuxième chantier de la phase 7 (« le cerveau TMS »), réponse au
> chantier n°2 de l'[audit TMS](../../audit-tms-2026-06-10.md) (§2/§3) : fenêtres
> temporelles early/late, vérification de capacité 3 axes, entité de jonction
> shipment↔load (déverrouille le multi-leg). Préalable de toute consolidation/optimisation
> future (un VRPTW a besoin d'intervalles ; un plan sans contrainte de capacité n'est pas
> un plan).

## Décisions structurantes

| Décision | Choix | Pourquoi |
| -------- | ----- | -------- |
| Politique de capacité | **Bloquant (400 détaillé) avec override explicite `force: true`, tracé à l'audit** | Intégrité par défaut ; le planificateur expérimenté peut passer outre (surcharge négociée, capacités saisies approximatives), mais sa décision est visible et auditée |
| Jonction shipment↔load | **`ShipmentLoadLeg` + `Shipment.loadId` conservé** comme dénormalisation « leg courant », écrits dans la même transaction | `loadId` est utilisé à 85 endroits dans 16 fichiers — un remplacement complet serait un gros risque de régression pour zéro gain immédiat (le multi-leg n'est pas au périmètre). La jonction anticipe le modèle exigé par l'audit ; invariant « jamais de divergence » testable |
| Fenêtres temporelles | Intervalles `[early, late?]` + validations dures de cohérence + **alerte non bloquante** quand le planifié sort du demandé | Le client a demandé, l'opérationnel décide. Les fenêtres dures/souples (OTM) sont différées : aucun consommateur tant qu'il n'y a pas de solveur (YAGNI) |
| Rétrocompatibilité DTO | **Rupture franche** (renommage sans couche de compatibilité), documentée | Décision posée explicitement : aucun consommateur externe de l'API transport en production ; le SPA, le portail et les e2e sont dans le repo et migrent d'un coup |
| Fuseaux horaires | Stockage UTC (convention existante) ; **les bornes s'interprètent dans le fuseau du site concerné** | Une fenêtre « 8 h–12 h » est une réalité locale du quai, pas un instant UTC abstrait — voir §1, paragraphe fuseaux |

## 1. Fenêtres temporelles early/late

### Modèle

Chaque date simple devient un intervalle `[early, late?]` (`late` null = borne ouverte) :

| Entité | Avant | Après |
| ------ | ----- | ----- |
| `TransportOrder` | `requestedPickupDate`, `requestedDeliveryDate` | `requestedPickupEarly`, `requestedPickupLate`, `requestedDeliveryEarly`, `requestedDeliveryLate` |
| `Shipment` | `plannedPickupAt`, `plannedDeliveryAt` | `plannedPickupEarly`, `plannedPickupLate`, `plannedDeliveryEarly`, `plannedDeliveryLate` |
| `Stop` | `plannedArrivalAt` | `plannedArrivalEarly`, `plannedArrivalLate` |

**Migration** : `ALTER TABLE ... RENAME COLUMN` de l'ancienne colonne vers `*Early`
(valeur existante = borne basse, sémantique « à partir de » préservée), ajout des
colonnes `*Late` nullable. Aucune perte de données.

### Validations dures (400)

- `early ≤ late` quand les deux bornes existent (par fenêtre).
- `pickupEarly ≤ deliveryLate` sur la même entité quand les deux existent.
- **Ne pas valider plus agressivement** : `pickupLate ≤ deliveryEarly` serait FAUX —
  des fenêtres chevauchantes sont légitimes (pickup 8 h–17 h, delivery 14 h–18 h le
  même jour).

### Alerte non bloquante (`windowWarnings`)

- Helper pur `windowViolations(requested, planned)` dans
  `packages/shared/src/planning/windows.ts` (testé vitest) : retourne les écarts quand
  une fenêtre planifiée sort de la fenêtre demandée correspondante (bornes ouvertes =
  pas de contrainte de ce côté).
- Exposé comme champ calculé `windowWarnings[]` dans les réponses de détail
  d'ordre et de détail de load (shipments planifiés vs demandé de l'ordre ; stops vs
  demandé). Badge dans le web. Jamais bloquant.

### Fuseaux horaires (sémantique)

Les horodatages restent stockés en **UTC** (convention du projet). La sémantique d'une
borne de fenêtre est **l'heure locale du site concerné** (`Location.timezone`, déjà en
schéma) : « livraison 8 h–12 h » signifie 8 h–12 h au quai de destination. En v1 l'UI
saisit/affiche dans le fuseau du navigateur (convention existante du SPA) — l'écart
n'est réel que pour un dispatch multi-fuseaux, noté comme raffinement futur (afficher
dans le fuseau du site). La spec fige l'interprétation pour que les futures
fonctionnalités (OTIF, solveur) lisent les bornes correctement.

### Impacts transverses identifiés

- **`RatingService.referenceDate()`** lit `plannedPickupAt` → bascule sur
  `plannedPickupEarly` (la date de référence du rating reste « premier pickup
  planifié »). Non-régression couverte par l'e2e rating existant.
- DTOs : création d'ordre, plan/split, **portail client** (saisie de commande),
  éditeur de route (stop times), clés API en écriture — tous passent aux paires.
- Pages publiques (tender, tracking, driver) : affichage des nouvelles bornes
  (early seul quand late absent — rendu identique à aujourd'hui).
- Analytics (ponctualité) : le calcul on-time existant utilise les dates actuelles —
  adapter la comparaison à `plannedDeliveryLate ?? plannedDeliveryEarly` (en retard =
  après la borne la plus tardive connue).

## 2. Vérification de capacité 3 axes

### Modèle

- `Trailer` gagne `capacityPallets Int?` (poids `capacityWeightKg` et volume
  `capacityVolumeM3` existent déjà).

### Fonction pure (shared)

`checkCapacity(capacities, totals)` dans `packages/shared/src/planning/capacity.ts`
(testé vitest) :

- Entrée : `{ weightKg?, volumeM3?, pallets? }` × 2 (capacités du trailer, totaux des
  shipments).
- Sortie : `CapacityExcess[]` — `{ axis: 'weightKg'|'volumeM3'|'pallets', capacity,
  requested, excess }`.
- **Un axe sans capacité saisie ou sans total calculable est ignoré** (on ne vérifie
  pas ce qu'on ne connaît pas) ; un résultat vide = rien à signaler.

### Points de contrôle (bloquants, override possible)

1. `POST /transportation/shipments/:id/assign-load` — somme des shipments déjà sur le
   load + le nouveau, vs capacités du trailer assigné (s'il y en a un).
2. `POST /transportation/loads/:id/assign` quand le **trailer** est assigné ou changé —
   mix existant vs capacités du nouveau trailer.

Comportement : 400 dont le corps contient la structure `CapacityExcess[]` **telle
quelle** (le front n'a qu'à l'afficher : capacité, demandé, excès par axe).
`force: true` dans le DTO passe outre ; l'entrée d'audit porte alors
`capacityOverride: true` + le détail des excès (décision tracée).

### Règle de pérennité

Aucun endpoint d'édition de shipment n'existe aujourd'hui (vérifié : le contrôleur
n'expose qu'assign/remove/cancel/share, et les commandes sont immuables après DRAFT).
**Règle pour l'avenir, à inscrire dans CLAUDE.md** : tout futur endpoint qui modifie le
poids/volume/palettes d'un shipment **assigné à un load** doit re-déclencher
`checkCapacity` sur ce load (niveau warning, pour ne pas bloquer les corrections de
saisie) — sans quoi la promesse « la capacité est vérifiée » a un trou par lequel
passe le cas le plus fréquent : la correction de dernière minute.

## 3. Jonction shipment↔load (`ShipmentLoadLeg`)

- Nouvelle table : `{ id, tenantId, shipmentId, loadId, sequence Int @default(1),
  createdAt }`, uniques `[shipmentId, sequence]` et `[shipmentId, loadId]`, index
  `[tenantId]`, `[loadId]`. FKs `Restrict` (cohérent avec la politique phase 7.1).
- **`Shipment.loadId` reste la dénormalisation « leg courant »** — aucun des 85 usages
  existants ne change.
- **Invariant (testé e2e)** : la jonction et `loadId` sont écrits dans la **même
  transaction Prisma** — jamais de divergence. En v1 (mono-leg) :
  - `assign-load` → upsert du leg (sequence 1) + `loadId` ;
  - `remove-load` → suppression du leg + `loadId = null` ;
  - `loads cancel` (shipments rendus au pool) → suppression des legs + `loadId = null`.
- **Migration backfill** : une ligne de jonction (sequence 1) par shipment ayant un
  `loadId` non nul.
- Le multi-leg futur ajoutera des séquences > 1 et fera évoluer `loadId` vers « leg
  actif » — le modèle de données n'aura plus à changer (exigence audit §3).

## 4. API & Web

- DTOs : paires early/late partout où les dates simples existaient (ordre, plan/split,
  portail public, route editor). `assign-load` et `loads/:id/assign` gagnent
  `force?: boolean`.
- Validations 400 de cohérence des fenêtres dans les services concernés (création
  d'ordre, plan, route editor).
- Web : formulaires ordre/portail avec paires de dates (late optionnel) ; éditeur de
  route avec fenêtre par stop ; badges `windowWarnings` sur détail d'ordre et de load ;
  erreur de capacité affichée par axe (capacité / demandé / excès) avec case « Forcer
  l'assignation » qui renvoie `force: true`.

## 5. Migration, tests

- 1 migration Prisma : renommages (`RENAME COLUMN` → `*Early`), ajout `*Late`,
  `Trailer.capacityPallets`, table `shipment_load_legs` + **backfill SQL** depuis
  `Shipment.loadId`.
- Vitest (shared) : `checkCapacity` (axes ignorés, multi-excès, exactement-à-capacité
  = pas d'excès), `windowViolations` (bornes ouvertes, planifié avant/après, fenêtres
  chevauchantes légitimes non signalées).
- Jest (API) : validations de fenêtres (400), construction du corps d'erreur capacité.
- E2E (suite phase 7.2) : fenêtres incohérentes → 400 ; planifié hors demandé →
  `windowWarnings` présent ; dépassement capacité → 400 avec `CapacityExcess[]` →
  `force: true` passe et l'audit porte l'override ; jonction backfillée puis maintenue
  à l'identique de `loadId` sur assign/remove/cancel ; non-régression rating
  (référence = `plannedPickupEarly`) et de toutes les suites existantes.

## 6. Hors périmètre (explicite)

Fenêtres dures/souples (flag OTM) ; multi-leg effectif (la jonction le prépare
seulement) ; consolidation automatique ; re-split post-exécution ; calendriers de
sites/jours fériés ; affichage des fenêtres dans le fuseau du site (raffinement noté
§1) ; couche de dépréciation des anciens champs DTO (aucun consommateur externe —
décision posée, rupture documentée au changelog).
