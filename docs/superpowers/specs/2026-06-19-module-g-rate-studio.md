# Module G — Rate Studio (spec)

Backlog: F→J. Branche `analytics-control-tower`. Autonomie (mandat Lebron).

## But

Un atelier de tarification : **simuler** un prix sur une voie/poids/date/transporteurs
**hypothétiques** (sans load), **comparer les transporteurs** côte à côte, et **expliquer**
pourquoi tel tarif (« why this rate? ») — le tout en réutilisant le moteur de rating déterministe
existant. Plus un hub UI qui relie les éditeurs existants (rates / lanes / accessorials / fuel).

## Existant réutilisé (NE PAS réimplémenter)

- `RatingService.rateOptions(tenantId, loadId)` (`rating.service.ts`) — shopping load-bound : matche
  les lanes via `candidateEndpointKeys`/`buildEndpointKey` (`@pulsar/shared/rating/lane-key`),
  évalue chaque rate, classe avec `compareRateOptions`.
- `RatingService.evaluate(rate, load, referenceDate)` + `calculateRateCost` (`@pulsar/shared/cost/
  rate-cost`) — math pure (FLAT/PER_KM/PER_HUNDREDWEIGHT(+brackets/deficit)/PER_PALLET/SPOT, fuel via
  `pickFuelEntry`, accessoriaux, minCharge). Snapshot self-contained.
- `compareLanes`/`ENDPOINT_SPECIFICITY`/`normalizeGeo` (shared) — ordre déterministe.
- CRUD existant + pages : rates, lanes, accessorials, fuel-tables.

## Périmètre LIVRÉ (G-phase-1)

### Backend — endpoint de simulation read-only

`POST /api/v1/transportation/rating/simulate`
- Gardes : `@RequireModule(MODULE_KEYS.TRANSPORTATION)` + la **même permission read** que les
  endpoints rates GET (probable `TRANSPORTATION.PLANNING_READ` — l'implémenteur confirme en lisant
  `rates.controller.ts`). Tenant-scopé (rule 1). Aucun écrit, aucune entité créée.
- Body :
  ```ts
  interface SimulateRateDto {
    // Origine/destination : soit une lane existante, soit des endpoints bruts
    laneId?: string;
    originType?: 'LOCATION'|'CITY'|'STATE'|'COUNTRY'; origin?: { locationId?; city?; state?; country? };
    destinationType?: ...; destination?: ...;
    weightKg?: number; distanceKm?: number; palletCount?: number;
    accessorialCodes?: string[];     // accessoriaux demandés
    referenceDate?: string;          // défaut = aujourd'hui
    carrierIds?: string[];           // restreindre la comparaison à ces transporteurs (option)
    customerId?: string; mode?: TransportMode;
  }
  ```
- Logique : construit l'ensemble de clés candidates avec les **mêmes helpers shared** que
  `rateOptions` (extraire un cœur load-free de `rateOptions`, OU une méthode `simulate` qui
  réutilise `candidateEndpointKeys`/`buildEndpointKey` + `calculateRateCost` + `compareRateOptions`).
  **Interdit** de dupliquer la math de coût ou la normalisation des clés.
  - Résout les endpoints depuis `laneId` (lit la lane) ou depuis les inputs bruts.
  - Matche les rates actifs/valides à `referenceDate` sur ces lanes (+ filtre `carrierIds` si fourni).
  - Évalue chaque rate via le chemin existant, classe avec `compareRateOptions`.
- Réponse : `{ referenceDate, resolved: { originKey, destinationKey }, options: RateOption[] }`
  où chaque `RateOption` = même shape que `rate-options` (rateId, rateName, carrier,
  laneSpecificity, breakdown{lines,base,fuelSurcharge,accessorialsTotal,total,appliedBreak,
  missingAccessorials}, fuel{pct,source,tableId?}). C'est le « why this rate? » : la spécificité de
  lane (tie-break), la source de fuel, le bracket appliqué, les accessoriaux manquants sont déjà là.

### Frontend — page `/rate-studio`

- `apps/web/src/routes/(app)/rate-studio/+page.svelte`. Pattern `$state`+`$effect`+`load()`,
  `api<T>()`, composants `$lib/components/ui`. Sections :
  1. **Simulateur** : formulaire (choisir une lane existante OU saisir origine/destination par type,
     poids, distance, palettes, date, accessoriaux multi-select, transporteurs multi-select). Bouton
     « Simuler » → `POST rating/simulate`.
  2. **Résultats / comparaison transporteurs** : table classée des options (transporteur, total,
     devise, spécificité lane, badge si accessoriaux manquants). Chaque ligne dépliable = breakdown
     complet (lignes base/fuel/accessoriaux/min, bracket appliqué) = le « pourquoi ».
  3. **Hub tarification** : liens rapides vers `/rates`, `/lanes`, `/accessorials`, `/fuel-tables`
     (cartes), pour garder Rate Studio comme point d'entrée cohérent.
- Gestion d'erreurs/empty states standard. Pas de nouveau design system.

### Navigation

- `navigation.ts` : domaine `transport`, section « Tarification », ajouter
  `{ href: '/rate-studio', label: 'Rate Studio', perm: <read perm> }` (en tête de section).
  Ajouter `/rate-studio` aux `prefixes` du domaine transport.

## DIFFÉRÉ (G-phase-2)

- Cibles d'import CSV `rates`/`lanes`/`accessorials`/`fuel-tables` (extension C4 `IMPORT_TARGETS`).
- Audit-trail dédié des changements de tarifs + « impact sur loads en attente ».
- « Test load » (créer un load jetable depuis une simulation).

## Règles

- Rule 1 (tenant scope sur simulate), 5 (gating), 16/17 (ne pas recalculer un snapshot figé — ici
  aucune écriture sur load, on lit/évalue à blanc), 17 (clés normalisées via shared). Pas d'entité,
  pas de migration, pas d'enum, pas de nouvelle permission.

## Tâches

- **G-T1 (backend)** : `RatingController.simulate` (ou nouveau `RatingController` si absent) +
  méthode `RatingService.simulate`. Réutilise helpers shared + `calculateRateCost` +
  `compareRateOptions`. DTO validé (class-validator). Vérifier : API boote, endpoint 200 avec shape
  correct sur une lane seedée, gating effectif, tenant-scopé, 0 nouvelle erreur typecheck.
- **G-T2 (frontend)** : page `/rate-studio` + nav. Vérifier : `pnpm --filter web typecheck` 0 erreur,
  la page simule et affiche la comparaison.
- Reviewer après chaque tâche.
