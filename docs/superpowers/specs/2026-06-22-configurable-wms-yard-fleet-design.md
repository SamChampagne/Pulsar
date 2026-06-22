# Configurable WMS / Yard / Fleet (arc D) — champs perso + règles de processus

> Spec de design. Quatrième sous-projet de l'arc « modules configurables niveau Odoo/SAP »
> (après TMS, Billing). Rejoue le **même patron** que TMS/Billing configurable sur les trois
> modules restants à surface documentaire : **WMS**, **Yard**, **Fleet**. Décidé avec Sam le
> 2026-06-22 : patron complet (champs perso + règles de processus), trois modules, exécuté
> module par module.

## 0. Intention & philosophie

Étendre la configurabilité tenant aux modules WMS/Yard/Fleet via les **deux leviers** déjà
posés, **sans nouveau mécanisme** :

- **A — Règles de processus** : descripteurs ajoutés/étendus dans `MODULE_SETTINGS_CATALOG`
  (`@pulsar/shared/config/module-settings.ts`), résolus par `ModuleSettingsService.resolve()`.
- **B — Champs personnalisés** : `CustomFieldsService` (core, déjà générique par `module`),
  `validateCustomFields` (pur), table `CustomFieldDefinition`, colonnes `customData Json?`.

**Invariant directeur** : tous les défauts = comportement actuel exact. Rien ne change tant
qu'aucun réglage n'est modifié et qu'aucun champ perso n'est défini. Rétro-compatibilité totale.

**Conformité CLAUDE.md** : règle 1 (tenant isolation définitions + valeurs), règle 2 (aucun
nouveau statut, state machines intactes — rules 32/33/34 préservées), règle 6 (audit config),
règle 8 (numéros via `SequencesService`, compteur indexé sur la clé jamais le préfixe), règle 9
(ownership FK), règle 35 (`customData` jamais écrit sans `validateCustomFields`, create **et**
update), règle 36 (`CustomFieldsService` générique paramétré par `module` ; contrôleur
`<module>/custom-fields` gated `@RequireModule` + `<module>.manage`).

## 1. Hors périmètre (YAGNI)

- **Aucun nouveau type de champ** (fichier/relation/formule) ni format de numéro autre que
  `PRÉFIXE-NNNNNN` — déjà hors périmètre des arcs précédents, inchangé.
- **WMS `overReceiptPolicy`** : abandonné — aucune branche « reçu > attendu » n'existe dans
  `receiving.service.ts` (vérifié) ; un knob sans consommateur runtime est interdit (note
  explicite du catalogue). Réintroduisible quand une telle branche existera.
- **Préfixe d'ordre de maintenance (Fleet)** : `MaintenanceOrder` n'a **pas** de numéro de
  document (cuid seul, vérifié) — aucun préfixe à configurer.
- **Champs perso sur entités internes** (StockMovement, InventoryLevel, YardMove, YardSpot,
  ComplianceDocument, Driver) : on se limite aux documents/assets cœur de chaque module.
- **Cycle-count (WMS)** : pas de champ perso ni préfixe configurable ce tour-ci (entité plus
  interne) ; extensible plus tard sans changement d'architecture.

---

## A. Règles de processus — par module

### A.1 WMS (nouveau catalogue `wms`)

| Réglage | Type | Défaut | Effet | Point d'application |
| --- | --- | --- | --- | --- |
| `documentPrefixReceipt` | string `^[A-Z0-9]{1,6}$` | `RC` | Préfixe des réceptions. | `SequencesService` (clé `receipt`) |
| `documentPrefixPickOrder` | string `^[A-Z0-9]{1,6}$` | `PK` | Préfixe des pick orders. | `SequencesService` (clé `pick-order`) |

Aucun toggle comportemental (over-receipt abandonné). Ajout des entrées correspondantes dans
`SequencesService.OVERRIDABLE` (`receipt`→`{wms, documentPrefixReceipt}`,
`pick-order`→`{wms, documentPrefixPickOrder}`).

### A.2 Yard (nouveau catalogue `yard`)

| Réglage | Type | Défaut | Effet | Point d'application |
| --- | --- | --- | --- | --- |
| `documentPrefixYardVisit` | string `^[A-Z0-9]{1,6}$` | `YV` | Préfixe des visites de cour. | `SequencesService` (clé `yard-visit`) |
| `documentPrefixDockAppointment` | string `^[A-Z0-9]{1,6}$` | `DA` | Préfixe des rendez-vous quai. | `SequencesService` (clé `dock-appointment`) |
| `spotConflictPolicy` | enum `BLOCK` / `WARN` | `BLOCK` | `BLOCK` = comportement actuel (`visits.service.ts:130` lève 409 si un spot a déjà une visite active). `WARN` = laisse passer l'affectation et renvoie un avertissement consultatif (pas de 409). | `VisitsService.assignToSpot` (+ `checkIn` si l'affectation directe y passe) |

Ajout des entrées `yard-visit`/`dock-appointment` dans `OVERRIDABLE`.

**`spotConflictPolicy` — consommateur réel confirmé** : le `throw new ConflictException('Spot
already occupied')` existant devient conditionnel. En `WARN`, l'occupation dérivée (`occ > 0`)
n'empêche plus l'affectation ; on renvoie le résultat avec un champ consultatif
(`spotWarnings: ['Spot already occupied']`) au lieu de 409. La dérivation d'occupation et
l'écriture transactionnelle de `YardMove` (rule 34) restent inchangées.

### A.3 Fleet (catalogue `fleet` existant — inchangé)

`complianceExpiringWindowDays` (déjà présent) reste le seul réglage de processus. Pas de
nouveau préfixe (cf. §1). La page config Fleet existante gagne juste la section champs perso.

### A.4 Note framework

Le type `string` + `pattern`/`maxLength`, l'`OVERRIDABLE` de `SequencesService` et le rendu web
des descripteurs existent déjà (arcs TMS/Billing). **Aucune extension de framework** requise —
on ajoute uniquement des données (catalogues) et un point d'application (`spotConflictPolicy`).

---

## B. Champs personnalisés — entités par module

`CustomFieldEntity` (`@pulsar/shared/config/custom-fields.ts`, miroir `schema.prisma` règle 3)
est étendu de 5 valeurs :

| Module | Entités ajoutées à `CustomFieldEntity` | Colonne `customData Json?` sur |
| --- | --- | --- |
| WMS | `RECEIPT`, `PICK_ORDER` | `Receipt`, `PickOrder` |
| Yard | `YARD_VISIT`, `DOCK_APPOINTMENT` | `YardVisit`, `DockAppointment` |
| Fleet | `VEHICLE`, `TRAILER`, `MAINTENANCE_ORDER` | `Vehicle`, `Trailer`, `MaintenanceOrder` |

**Couplage Vehicle/Trailer (à expliciter — rule 32)** : les trois définitions
(`VEHICLE`/`TRAILER`/`MAINTENANCE_ORDER`) sont scopées `module='fleet'` et s'éditent **toutes**
depuis la page Configuration Fleet. Mais le CRUD des assets vit dans des modules différents :

- `MaintenanceOrder` : CRUD dans le module **fleet** → ses endpoints valident `customData`
  directement contre les définitions `module='fleet'`.
- `Vehicle`/`Trailer` : CRUD réutilisé sous `transportation/{vehicles,trailers}` (rule 32, pas
  de duplication). Ces endpoints transportation valident `customData` contre les définitions
  **`module='fleet'`** via le `CustomFieldsService` (core, générique — lecture cross-module
  assumée, pas un nouveau couplage de modules au sens DI). Les `<CustomFieldInputs>` Vehicle/
  Trailer se rendent donc sur les formulaires roster transportation, en chargeant
  `GET /fleet/custom-fields?entityType={VEHICLE,TRAILER}`. Le module Fleet doit être activé pour
  que ces champs apparaissent (sinon `GET /fleet/custom-fields` est gated 403 → liste vide → on
  n'affiche rien, comportement par défaut préservé).

### B.1 Modèle & validation (inchangés)

Réutilise la table `CustomFieldDefinition` (`@@unique([tenantId, module, entityType, key])`) et
la fonction pure `validateCustomFields`. Rien à modifier côté schéma de définitions ; seules
s'ajoutent les valeurs d'enum `CustomFieldEntity` et les colonnes `customData` sur 7 modèles.

### B.2 API — par module

Trois contrôleurs `<module>/custom-fields`, copie conforme du patron TMS/Billing :

- `GET /<module>/custom-fields?entityType=` et `PUT /<module>/custom-fields` (remplace
  l'ensemble d'un `entityType`, transactionnel, `@Audit('custom-field-definition','update')`,
  `@RequireModule(MODULE_KEYS.<X>)` + `<module>.manage`, tenant-scopé).
- Les DTO `Create*`/`Update*` des entités concernées acceptent `customData?` validé via
  `customFields.validateValues('<module>', tenantId, <Entity>, data, { partial })` **avant
  persistance** (create ET update — rule 35). Les projections GET (list + detail) incluent
  `customData`.
- `wms.manage` / `yard.manage` / `fleet.manage` existent déjà — **aucune nouvelle permission**.

### B.3 Web — par module

- **Éditeur de définitions** : section « Champs personnalisés » (composant
  `CustomFieldsEditor`) ajoutée à chaque page Configuration de module
  (`/settings/modules/{wms,yard,fleet}`), avec le sélecteur d'entité du module. Les pages WMS et
  Yard n'existent pas encore → à créer (mêmes briques que `/settings/modules/transportation`).
  Fleet existe → on y ajoute la section.
- **Saisie** : `<CustomFieldInputs>` (déjà corrigé du crash `props_invalid_value`, commit
  `4b97fe1`) inséré sous les champs natifs des formulaires create/edit des entités concernées,
  qui chargent leurs définitions via `GET /<module>/custom-fields?entityType=`.
- **Affichage** : `customData` rendu en détail (paires label/valeur) + colonnes de liste pour
  `showInList=true`, via le helper de formatage partagé.
- **Nav** : lien « Configuration » par module (déjà présent pour Fleet dans `navigation.ts` ;
  à ajouter pour WMS et Yard) → `/settings/modules/{wms,yard}`.

---

## C. Migration & permissions

- **1 migration** : 5 nouvelles valeurs d'enum `CustomFieldEntity` + 7 colonnes `customData
  Json?` (`Receipt`, `PickOrder`, `YardVisit`, `DockAppointment`, `Vehicle`, `Trailer`,
  `MaintenanceOrder`). Aucun nouveau statut, aucune state machine touchée (règle 2).
- **Aucune nouvelle permission** : config sous `<module>.manage` ; valeurs sous les
  `<module>.*` existantes.
- **Seed** : optionnel — pas de champ perso ni de réglage seedé (défauts = comportement actuel).

---

## D. Tests

- **Unit (`@pulsar/shared`)** :
  - `resolveSettings` pour les nouveaux catalogues `wms`/`yard` (défauts == valeurs statiques
    actuelles `RC`/`PK`/`YV`/`DA`, `spotConflictPolicy=BLOCK`).
  - `validateCustomFields` est déjà couvert ; ajouter un cas par nouvelle entité n'apporte rien
    (la fonction est agnostique de l'entité) — pas de duplication.
- **e2e** (DB seedée), un fichier par module ou un fichier `configurable-wms-yard-fleet` :
  - **Préfixes** : `documentPrefixReceipt='RCV'` → prochaine réception `RCV-000001`, compteur
    non réinitialisé ; idem pick-order, yard-visit, dock-appointment.
  - **Yard `spotConflictPolicy`** : deux visites actives sur le même spot → `BLOCK` = 409 ;
    `WARN` = 2ᵉ affectation acceptée avec `spotWarnings` non vide + `YardMove` écrit.
  - **Champs perso** : définir un champ `SELECT` requis sur `RECEIPT` (resp. `YARD_VISIT`,
    `VEHICLE`) → create sans valeur = 400 → hors options = 400 → valide = 201 avec `customData`
    dans la projection GET → isolation tenant (les définitions d'un tenant B ne fuient pas).
  - **Défauts** : sans réglage ni champ défini, tous les parcours WMS/Yard/Fleet existants
    restent verts.

---

## E. Découpage d'implémentation (aperçu — détaillé dans le plan)

Exécution **module par module** (WMS → Yard → Fleet), chacun autonome :

1. `@pulsar/shared` : valeurs d'enum `CustomFieldEntity` + descripteurs catalogue (`wms`, `yard`)
   + entrées `OVERRIDABLE` + tests unit catalogues. Rebuild shared (règle 7).
2. `packages/database` : 1 migration (enum + 7 colonnes `customData`), regen, reseed.
3. API : 3 contrôleurs `<module>/custom-fields` + acceptation/validation `customData` dans les
   DTO + projections + point d'application `spotConflictPolicy` (Yard).
4. Web : pages Configuration WMS & Yard (créées), section champs perso Fleet (ajoutée),
   `<CustomFieldInputs>` sur les formulaires, affichage liste/détail, liens nav.
5. e2e + vérification navigateur (préfixes, spotConflictPolicy, champ perso bout-en-bout).
