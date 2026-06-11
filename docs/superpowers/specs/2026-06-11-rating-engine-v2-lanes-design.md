# Phase 7.1 — Rating engine v2 + entité Lane : design

> Validé le 2026-06-11. Premier chantier de la phase 7 (« le cerveau TMS »), réponse
> directe au chantier n°1 de l'[audit TMS](../../audit-tms-2026-06-10.md) (§5 + §1) :
> Lane de première classe, tarifs rattachés aux lanes, tranches dégressives avec règle
> « as-if », accessorials avec table carburant datée, persistance du détail de calcul,
> rate shopping. Préalable du Billing sell-side (chantier 7.3).

## Décisions structurantes

| Décision | Choix | Pourquoi |
| -------- | ----- | -------- |
| Modèle de lane | Entité `Lane` de première classe, hiérarchie géo **site < ville < province < pays** | Support commun exigé par l'audit pour tarifs, routing guide (auto-tender) et KPI par lane. Les zones génériques (grilles zone×zone, niveau OTM) et les préfixes postaux (FSA/ZIP3) sont écartés — la hiérarchie choisie n'y ferme pas la porte |
| Auditabilité du calcul | **Snapshot Json figé** sur le load (`costDetail`), pas de versions immuables de tarifs | Le snapshot autonome (tarif tel qu'utilisé + intrants + lignes) suffit à l'exigence « tout calcul ré-explicable a posteriori » sans la machinerie de publication/versionnage. Voir les **invariants du snapshot** ci-dessous — ce sont eux qui rendent les tarifs mutables tolérables |
| Rate shopping | Liste classée, choix manuel ; le meilleur mis en avant | Garde le contrôle au planificateur tant que les grilles sont incomplètes ; l'assignation existante reste le seul chemin d'écriture |
| Accessorials | Catalogue par tenant + prix par tarif + flags sur le load | Le rate shopping compare les transporteurs à périmètre égal ; texte libre par tarif rendrait la comparaison impossible |
| Règle « as-if » (deficit weight) | **Incluse** dans le périmètre | Toute la structure (tranches) est déjà dans le design ; la règle tient en quelques lignes dans la fonction pure. Payer plus pour 480 kg que pour 500 kg est l'anomalie la plus visible pour un client LTL |
| Suppression des entités référencées | **Restrict partout** (refus avec message clair) | Ni cascade ni set-null silencieux : les snapshots historiques sont autonomes (Json), seul le référentiel vivant est protégé |

## 1. Modèle de données

### `Lane` (nouvelle table `lanes`)

Tenant-scopée. Chaque extrémité (origine, destination) est définie à un niveau de la
hiérarchie via `LaneEndpointType` (`LOCATION | CITY | PROVINCE | COUNTRY`, enum partagé
dans `packages/shared`, miroir Prisma) :

- `originType`, `originLocationId?`, `originCity?`, `originProvince?`, `originCountry?`
  (idem `destination*`). Champs requis selon le type : `LOCATION` ⇒ `locationId` ;
  `CITY` ⇒ ville + province + pays ; `PROVINCE` ⇒ province + pays ; `COUNTRY` ⇒ pays.
  Validé par DTO (class-validator) et re-vérifié en service.
- **Clés normalisées calculées** `originKey` / `destinationKey` (string), construites en
  service au create/update : `LOCATION:<locationId>`, `CITY:<pays>|<province>|<ville>`,
  `PROVINCE:<pays>|<province>`, `COUNTRY:<pays>`.
  - **Normalisation** : trim, minuscules, **suppression des diacritiques (NFD + strip
    des combining marks)** — « Montréal », « Montreal » et « MONTREAL » produisent la
    même clé. Indispensable pour le marché québécois.
  - `@@unique([tenantId, originKey, destinationKey])` — **deux lanes strictement
    identiques sont impossibles à créer** (409 avec message clair).
- `name?` (libellé d'affichage), timestamps.
- Relations : `rates Rate[]`, `carrierPreferences LaneCarrierPreference[]`.
- Index : `@@index([tenantId])` (+ l'unique ci-dessus qui sert au matching par `IN`).

### Matching et spécificité (règle déterministe)

- Spécificité d'une extrémité : `LOCATION=3, CITY=2, PROVINCE=1, COUNTRY=0`.
- Pour un load, on calcule les clés candidates de son origine et de sa destination
  (4 clés chacune, dérivées de la `Location` réelle) → les lanes qui matchent sont
  trouvées en une requête `WHERE originKey IN (...) AND destinationKey IN (...)`.
- **Ordre de sélection (total ordering, écrit une fois dans `RatingService` et réutilisé
  par l'auto-tender)** :
  1. spécificité totale (origine + destination) décroissante ;
  2. à égalité (ex. 3+2 vs 2+3) : **spécificité de la destination** décroissante ;
  3. puis spécificité de l'origine décroissante ;
  4. puis `createdAt` décroissant (la lane la plus récente gagne — filet déterministe,
     l'unique sur les clés rend ce cas rare).

  Sans cette règle, le tarif retenu dépendrait de l'ordre de la base — non-déterminisme
  de production interdit.
- **Origine/destination d'un load** : premier pickup et dernière delivery via les stops
  de la route si elle existe ; sinon via les shipments quand ils partagent tous la même
  origine et la même destination. Si indéterminable (multi-origines sans route), seuls
  les tarifs attrape-tout (`laneId = null`) s'appliquent.

### `LaneCarrierPreference` (refonte)

`originLocationId`/`destinationLocationId` remplacés par `laneId` (FK `Restrict`).
Uniques recalées sur `[tenantId, laneId, rank]` et `[tenantId, laneId, carrierId]`.
**Migration de données SQL** dans la migration Prisma : chaque paire (origine,
destination) existante crée une `Lane` LOCATION→LOCATION (clés calculées en SQL —
les ids ne contiennent pas de diacritiques) et les préférences y sont rattachées.
L'auto-tender (`TendersService` / `LanesService`) cherche désormais **la lane la plus
spécifique qui matche le load et qui a des préférences** (même ordre de sélection que
le rating). Les paires migrées étant LOCATION→LOCATION (spécificité max), le
comportement existant est préservé à l'identique.

### `Rate` (extension — pas de migration de données)

- `laneId?` (FK `Restrict`) — `null` = tarif attrape-tout (comportement actuel intact).
- `fuelTableId?` (FK `Restrict`) — prime sur `fuelSurchargePct` statique (conservé en
  fallback).
- Relations `breaks RateBreak[]`, `accessorialPrices RateAccessorialPrice[]`.
- `validFrom`/`validTo` deviennent **réellement appliqués** (calcul + shopping) — voir
  la date de référence ci-dessous.

### `RateBreak` (nouvelle table `rate_breaks`)

Tranches dégressives pour `PER_HUNDREDWEIGHT` : `{ rateId, upToKg Float, amount
Decimal(12,2) }` — `amount` par CWT applicable quand le poids total ≤ `upToKg` ; la
dernière tranche s'applique au-delà. `@@unique([rateId, upToKg])`. Sans tranches,
`baseAmount` s'applique comme aujourd'hui. Les DTO refusent les tranches sur les autres
types de tarif.

**Règle « as-if »** : pour le poids W dans la tranche i, calculer aussi le coût « comme
si » W = borne inférieure de la tranche i+1 (c.-à-d. `upToKg` de la tranche i, au tarif
de la tranche i+1) et **retenir le minimum**. La ligne de calcul indique quand la règle
s'est appliquée (`asIfApplied: true`, poids et tranche retenus).

### `Accessorial` / `RateAccessorialPrice` / `LoadAccessorial` (nouvelles tables)

- `Accessorial` — catalogue tenant : `code` (`@@unique([tenantId, code])`), `name`,
  `unit` enum `AccessorialUnit` (`FLAT | PER_HOUR | PER_UNIT`, partagé + miroir Prisma).
- `RateAccessorialPrice` — `{ rateId, accessorialId, amount Decimal(12,2) }`,
  `@@unique([rateId, accessorialId])`.
- `LoadAccessorial` — flags posés par le planificateur : `{ loadId, accessorialId,
  quantity Float @default(1) }`, `@@unique([loadId, accessorialId])`. `quantity`
  ignorée (forcée à 1) pour `FLAT`.

### `FuelSurchargeTable` / `FuelSurchargeEntry` (nouvelles tables)

- Table par tenant : `{ tenantId, name }` + entrées datées `{ tableId, effectiveFrom
  DateTime, pct Float }`, `@@unique([tableId, effectiveFrom])`.
- Résolution : l'entrée la plus récente dont `effectiveFrom` ≤ **date de référence**.
  Aucune entrée applicable ⇒ surcharge 0, signalé dans le détail.

### Date de référence (une seule règle, deux usages)

`plannedPickupAt` du premier pickup du load (sinon date du jour). Elle gouverne **à la
fois** la sélection de l'entrée carburant **et** la validité `validFrom`/`validTo` des
tarifs — les deux résolutions sont cohérentes par construction et la date retenue est
persistée dans le snapshot.

### `Load.costDetail` (snapshot)

`costDetail Json?` + `estimatedCost`/`costCurrency` existants. Contenu du snapshot :
tarif tel qu'utilisé (id, nom, type, montants, tranches, prix d'accessorials, % carburant
retenu et provenance table/statique), intrants (poids, km, palettes, accessorials avec
quantités, date de référence), lignes de calcul, tranche appliquée, règle as-if le cas
échéant, total, devise, horodatage.

**Invariants du snapshot (les deux phrases qui tiennent l'audit trail)** :

1. **Un load COMPLETED ne se recalcule jamais** — `LoadCostService.recompute()` refuse
   les loads complétés (étend le gel existant d'`estimatedCost` au `costDetail`). Le
   snapshot fait foi.
2. **Le rapprochement de factures (Billing v2, phase 6) lit le montant attendu depuis
   `estimatedCost`/`costDetail` figés, jamais par recalcul.** Modifier un tarif ne doit
   jamais réécrire silencieusement l'historique des écarts. (Comportement actuel déjà
   conforme — `estimatedCost` figé à la complétion — l'invariant est désormais écrit et
   testé.)

## 2. Moteur de calcul v2 (`packages/shared/src/cost/rate-cost.ts`)

La fonction pure `calculateRateCost` évolue (même fichier, vitest) :

- **Entrée** : tarif enrichi (type, baseAmount, minCharge, tranches, prix d'accessorials,
  % carburant **résolu** en amont), intrants (distanceKm, weightKg, palletCount),
  accessorials demandés `{ code, unit, quantity }`.
- **Sortie** : `lines[]` typées (`BASE`, `FUEL`, `ACCESSORIAL`, `MIN_CHARGE_ADJUSTMENT`)
  avec libellés et montants, tranche appliquée + as-if le cas échéant,
  `missingAccessorials[]` (demandés mais non tarifés — **le total reste calculé**, le
  manque est signalé), total arrondi à 2 décimales.
- La **résolution** (lane matching, choix de l'entrée carburant, validité par date de
  référence) vit côté API dans un nouveau **`RatingService`**
  (`apps/api/src/modules/transportation/rating/`) ; shared ne contient que
  l'arithmétique pure — même discipline que l'existant.
- `LoadCostService.recompute()` appelle ce pipeline et persiste `estimatedCost` +
  `costDetail`. Déclencheurs existants conservés (assignation du tarif, rebuild de
  route) **plus** : modification des accessorials du load.

## 3. Rate shopping

`GET /transportation/loads/:id/rate-options` :

- Évalue tous les tarifs `ACTIVE` valides à la date de référence dont la lane matche le
  load (ou attrape-tout).
- Tri : par coût total croissant **par devise** (aucune conversion — les devises
  différentes sont des groupes séparés) ; les candidats avec `missingAccessorials` sont
  classés **après** les complets de leur devise (évite le « moins cher parce qu'il
  manque des frais »).
- Réponse par candidat : `{ rateId, rateName, carrier, laneSpecificity (et niveaux
  origine/destination), breakdown complet, missingAccessorials }`.
- Lecture seule — l'assignation reste l'endpoint existant (choix manuel).

## 4. API (module transportation, conventions REST existantes)

| Endpoint | Notes |
| -------- | ----- |
| `GET/POST/PATCH/DELETE /transportation/lanes` | CRUD complet (remplace le GET/PUT actuel limité aux préférences). Permissions `transportation.lanes.*` existantes réutilisées |
| `PUT /transportation/lanes/:id/carriers` | Préférences transporteur = sous-ressource ordonnée de la lane |
| `GET/POST/PATCH/DELETE /transportation/accessorials` | Nouvelle permission `transportation.accessorials.manage` (+ `read`) au catalogue + seed |
| `GET/POST/PATCH/DELETE /transportation/fuel-tables` (+ gestion des entrées) | Nouvelle permission `transportation.fuel-tables.manage` (+ `read`) |
| `rates` (existant) | DTO étendus : `laneId`, `fuelTableId`, `breaks[]`, `accessorialPrices[]` |
| `PUT /transportation/loads/:id/accessorials` | Remplace l'ensemble des flags ; déclenche `recompute()` |
| `GET /transportation/loads/:id/rate-options` | Rate shopping (lecture) |

Règles transverses : `OwnershipService.assertOwned(IfSet)` sur **toutes** les FK
acceptées en écriture (laneId, fuelTableId, accessorialId, locationId…) ; `@Audit` sur
toutes les mutations master-data ; `@RequireModule(MODULE_KEYS.TRANSPORTATION)` ;
listes en `Paginated<T>`.

**Politique de suppression (restrict partout, message clair)** :

- `DELETE lane` refusé si des rates ou des préférences la référencent ;
- `DELETE accessorial` refusé si référencé par un `RateAccessorialPrice` ou un
  `LoadAccessorial` ;
- `DELETE fuel-table` refusé si référencée par un rate.

Doublé en schéma (`onDelete: Restrict`) et en service (vérification + 409 avec le
décompte des références, plutôt qu'une erreur Prisma opaque).

## 5. Web

- **Page Lanes refondue** : CRUD lanes (sélecteur de niveau par extrémité, champs
  conditionnels) + transporteurs préférés par lane (rangs, comme aujourd'hui).
- **Nouvelle page Rates** (n'existe pas aujourd'hui — l'API seule gère les tarifs) :
  liste + formulaire complet (lane, type, montants, tranches, prix d'accessorials,
  table carburant, validité, statut).
- **Pages Accessorials et Fuel tables** (sections Settings, pattern existant).
- **Load detail** : bloc accessorials (cases + quantités) ; panneau « Comparer les
  tarifs » — candidats classés avec détail dépliable, **spécificité de la lane affichée**
  (c'est ce qui explique au planificateur pourquoi tel tarif s'applique), bouton
  Assigner ; snapshot `costDetail` affiché sous le coût estimé.
- Navigation conditionnée à `transportation` dans `(app)/+layout.svelte`, pattern
  `$state` + `load()` + `api<T>()` existant.

## 6. Migration, seed, tests

- **1 migration Prisma** : nouvelles tables (`lanes`, `rate_breaks`, `accessorials`,
  `rate_accessorial_prices`, `load_accessorials`, `fuel_surcharge_tables`,
  `fuel_surcharge_entries`), extensions `Rate` et `Load.costDetail`, refonte
  `LaneCarrierPreference` **avec migration de données SQL** (création des lanes
  LOCATION→LOCATION puis bascule des FK — aucune perte).
- **Seed** : lanes d'exemple (une LOCATION→LOCATION migrée naturellement + une
  CITY→CITY), catalogue d'accessorials de base (hayon `TAILGATE`, attente `WAIT_HOUR`,
  résidentiel `RESIDENTIAL`), une table carburant avec 2 entrées datées, un tarif
  complet (lane + tranches + accessorials + table).
- **Vitest (shared)** : tranches (bornes incluses/excluses, dernière tranche ouverte),
  règle as-if (cas 480 kg vs 500 kg), accessorials par unité (FLAT/PER_HOUR/PER_UNIT),
  `missingAccessorials`, interaction minCharge (après carburant et accessorials),
  arrondis.
- **Jest unitaires (API)** : normalisation des clés (diacritiques, casse, trim),
  matching par spécificité **avec les cas d'égalité (3+2 vs 2+3 ⇒ destination gagne)**,
  date de référence (pickup planifié vs aujourd'hui), sélection d'entrée carburant.
- **E2E** (suite phase 7, master data à codes uniques, rejouable) : créer
  lane/accessorials/fuel-table/rate → planifier un load → flags accessorials →
  `rate-options` (ordre, devises, incomplets derrière) → assigner → `costDetail`
  persisté et conforme → compléter le load → vérifier que recompute est refusé et que
  le snapshot survit à une modification du tarif → l'auto-tender utilise la lane la
  plus spécifique.

## 7. Hors périmètre (explicite)

Conversion de devises ; grilles zone×zone et zones génériques ; préfixes postaux
(FSA/ZIP3) ; classes NMFC/FAK ; versions immuables de tarifs (le snapshot y supplée) ;
sell-side (chantier 7.3, débloqué par ce chantier) ; moteur cartographique pour les
distances (audit §7, hors chantier).
