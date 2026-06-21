# TMS configurable v1 — socle (workflow/règles + champs personnalisés)

> Spec de design. Premier sous-projet de l'arc « modules adaptés à plein de scénarios, niveau
> Odoo/SAP ». Arc macro adopté avec Sam le 2026-06-21 : **configurabilité → largeur fonctionnelle
> → presets verticaux**, en commençant par le **TMS** ; chaque module suivant rejoue le même patron.
> Ce spec couvre uniquement le **socle de configurabilité du TMS**.

## 0. Intention & philosophie

Un seul code TMS qui s'adapte à plein de scénarios métier via **deux leviers complémentaires** :

- **A — Règles de processus configurables** : *comment* le flux se comporte (tendering obligatoire
  ou non, POD/BOL requis, strictness des fenêtres, numérotation des documents). Étend le framework
  de configuration mergé le 2026-06-20.
- **B — Champs personnalisés** : *quelles données* le tenant capture en plus sur ses entités cœur
  (référence PO client, n° de douane, centre de coût, etc.). Nouveau sous-système.

**Invariant directeur** : tous les défauts = comportement actuel exact. Activer/ouvrir le module
ne change strictement rien tant qu'un réglage n'est pas modifié et qu'aucun champ personnalisé
n'est défini. Rétro-compatibilité totale.

**Conformité CLAUDE.md** : règle 1 (tenant isolation sur définitions ET valeurs), règle 2 (aucun
nouveau statut, aucune modification des state machines), règle 6 (audit des mutations de config),
règle 8 (numéros via `SequencesService`), règle 9 (ownership des FK), règle 11 (recompute coût
inchangé). Les gates de processus = lecture d'un settings résolu, jamais un bypass des plafonds
d'agents.

## 1. Hors périmètre (YAGNI)

- **Portes d'approbation humaines** (statut `PENDING_APPROVAL` + rôle approbateur) : impliquerait
  de nouveaux statuts et une refonte des state machines (règle 2). Reporté à un spec dédié.
- **Champs personnalisés sur Stop / Tender / Route** : on se limite aux 3 entités cœur
  (`TransportOrder`, `Shipment`, `Load`). Extensible plus tard sans changement d'architecture.
- **Format de numéro autre que `PRÉFIXE-NNNNNN`** : on rend le préfixe configurable, pas le
  gabarit (padding, séparateur, compteurs par année). Reporté.
- **Types de champ avancés** (fichier, relation vers une autre entité, formule) : v1 se limite à
  `text / number / date / boolean / select`.

---

## A. Règles de processus configurables

Nouveaux descripteurs ajoutés au catalogue `transportation` dans
`packages/shared/src/config/module-settings.ts`, consommés via `ModuleSettingsService.resolve()`
aux points de décision déjà localisés dans le code.

| Réglage | Type | Défaut | Effet | Point d'application |
| --- | --- | --- | --- | --- |
| `requireTendering` | enum `DISABLED` / `OPTIONAL` / `REQUIRED` | `OPTIONAL` | `OPTIONAL` = comportement actuel (tender, auto-tender ou assignation directe au choix). `REQUIRED` = un load ne peut passer à `DISPATCHED` que s'il existe un tender `ACCEPTED`. `DISABLED` = pas d'auto-tender, assignation directe seulement (la création de tender est refusée 400). | `loads.service.ts` (dispatch + assignResources), `tenders.service.ts` (create + autoTender) |
| `podRequiredBeforeCompletion` | boolean | `false` | `true` = la complétion d'un load (→ shipments `DELIVERED`) est refusée 400 si un shipment du load n'a pas de `proofOfDelivery`. | `loads.service.ts` (complete) |
| `bolRequiredBeforeDispatch` | boolean | `false` | `true` = le passage à `DISPATCHED` est refusé 400 si aucun BOL n'a été généré pour le load. | `loads.service.ts` (dispatch) |
| `windowCoherence` | enum `STRICT` / `LENIENT` | `STRICT` | `STRICT` = comportement actuel (incohérence de fenêtre → 400 dur). `LENIENT` = l'incohérence devient un avertissement consultatif (`windowWarnings`) au lieu d'un rejet. | `window-validation.ts` via les services qui appellent `assertWindowCoherence` |
| `documentPrefixTransportOrder` | **string** | `TO` | Préfixe de numérotation des ordres pour ce tenant. | `SequencesService.nextNumber` |
| `documentPrefixShipment` | **string** | `SH` | Préfixe de numérotation des shipments. | idem |
| `documentPrefixLoad` | **string** | `LD` | Préfixe de numérotation des loads. | idem |

### A.1 Extension du framework : type `string`

Le framework actuel ne supporte que `enum / boolean / number`. On ajoute un type **`string`** :

- `SettingType` += `'string'` ; `SettingDescriptor` gagne `pattern?: string` et `maxLength?: number`.
- `isValid` (dans `module-settings.ts`) valide : `typeof v === 'string'`, longueur ≤ `maxLength`,
  et `new RegExp(pattern).test(v)` si `pattern` fourni.
- Les 3 descripteurs de préfixe utilisent `pattern: '^[A-Z0-9]{1,6}$'`, `maxLength: 6`.
- `ModuleSettings.svelte` (web) rend le type `string` comme un `<Input type="text">` avec le help.

### A.2 Numérotation configurable (règle 8 préservée)

`SequencesService.nextNumber(tenantId, key)` lit aujourd'hui un préfixe d'une table statique
`PREFIXES`. On le rend configurable **sans casser la règle 8** (les numéros continuent de passer
exclusivement par ce service) :

- Pour les 3 clés TMS (`transport-order`, `shipment`, `load`), `nextNumber` résout d'abord le
  réglage `transportation` correspondant ; s'il est présent et valide, il l'utilise comme préfixe,
  sinon il retombe sur la valeur statique (le défaut du catalogue == la valeur statique actuelle,
  donc aucun changement observable par défaut).
- Le **compteur** reste indexé sur la clé de séquence (`transport-order`/…), **pas** sur le
  préfixe : changer le préfixe ne réinitialise pas la numérotation et deux préfixes ne partagent
  jamais la même suite. Le format `PRÉFIXE-NNNNNN` (6 chiffres) est inchangé.
- `SequencesService` doit donc dépendre de `ModuleSettingsService` (déjà un service core,
  pas de cycle de dépendance — à vérifier au câblage ; sinon, lecture directe via
  `TenantModulesCacheService`).

---

## B. Champs personnalisés (custom fields)

Permet à chaque tenant d'ajouter ses propres champs sur `TransportOrder`, `Shipment`, `Load`,
affichés/validés/persistés dynamiquement.

### B.1 Modèle de données

**Définitions** — nouvelle table `CustomFieldDefinition` :

| Colonne | Type | Notes |
| --- | --- | --- |
| `id` | String (cuid) | PK |
| `tenantId` | String | règle 1, indexé |
| `module` | String | `'transportation'` (généralise aux autres modules plus tard) |
| `entityType` | enum `CustomFieldEntity` | `TRANSPORT_ORDER` / `SHIPMENT` / `LOAD` |
| `key` | String | clé technique, `^[a-z][a-zA-Z0-9_]{0,39}$` ; unique par `(tenantId, module, entityType, key)` |
| `label` | String | libellé affiché |
| `type` | enum `CustomFieldType` | `TEXT` / `NUMBER` / `DATE` / `BOOLEAN` / `SELECT` |
| `options` | Json? | liste `{value,label}` pour `SELECT` |
| `required` | Boolean | défaut `false` |
| `showInList` | Boolean | défaut `false` — colonne de liste |
| `sortOrder` | Int | ordre d'affichage |
| `createdAt`/`updatedAt` | DateTime | |

Index unique `@@unique([tenantId, module, entityType, key])` + index `[tenantId, module, entityType]`.

**Valeurs** — colonne `customData Json?` ajoutée sur `TransportOrder`, `Shipment`, `Load`.
Forme : `Record<string, string | number | boolean | null>` (la date est stockée en ISO string).

Les enums `CustomFieldEntity` / `CustomFieldType` vivent dans `packages/shared` ET sont mirorés
dans `schema.prisma` (règle 3).

### B.2 Validation pure (`@pulsar/shared`)

Fonction pure `validateCustomFields(defs: CustomFieldDefinition[], data: unknown)` →
`{ ok: true; value } | { ok: false; errors }` :

- rejette toute clé absente des définitions (`Unknown field "x"`) ;
- valide le type (`TEXT`→string, `NUMBER`→number fini, `DATE`→ISO date parseable,
  `BOOLEAN`→boolean, `SELECT`→string ∈ options) ;
- applique `required` (manquant/null/'' sur un champ requis → erreur) ;
- ignore les définitions non fournies (patch partiel autorisé sur update, mais `required` est
  vérifié à la création complète).
- Testée unitairement. **Jamais réimplémentée** côté API (réutilisée par les DTOs).

### B.3 API

- **Définitions** (gated `core.modules.manage`, `@RequireModule(TRANSPORTATION)`, tenant-scopé) :
  - `GET /transportation/custom-fields?entityType=` → définitions du tenant.
  - `PUT /transportation/custom-fields` → remplace l'ensemble des définitions d'un `entityType`
    (sémantique PUT, transactionnel) ; audité (`@Audit('custom-field-definition', 'update')`,
    règle 14). Refuse de changer le `type` d'un champ qui a déjà des valeurs ? → **v1 : autorisé**
    mais documenté (les valeurs existantes incompatibles seront ignorées à la lecture par
    `resolve`/projection). On garde simple ; pas de migration de données.
  - Suppression d'un champ = absence dans le PUT. Les valeurs orphelines restent dans `customData`
    mais ne sont plus projetées ni éditables (nettoyage paresseux, pas de migration).
- **Entités** : les DTO `Create*`/`Update*` de `TransportOrder`, `Shipment` (splits), `Load`
  acceptent un `customData?: Record<string, unknown>` validé contre les définitions du tenant
  via `validateCustomFields` **avant persistance** ; erreur → 400. Les projections GET
  (list + detail) incluent `customData`.

### B.4 Web

- **Éditeur de définitions** : section dans la page Configuration du module
  (`/settings/modules/transportation`) — un onglet/sous-bloc « Champs personnalisés » par
  `entityType`, avec ajout/suppression/réordonnancement (réutilise le pattern de lignes
  dynamiques déjà présent dans le plan-split).
- **Composant générique** `<CustomFieldInputs definitions data bind:... />` dans
  `apps/web/src/lib/components/` : rend dynamiquement Input/Input[number]/Input[date]/checkbox/
  Select selon `type`, dans le même style `Field`. Inséré sous les champs natifs des formulaires
  create/edit de TransportOrder, Shipment (split), Load.
- **Affichage** : helper de rendu en détail (paires DL/DD, dans les cartes résumé) et colonnes
  de liste pour les définitions `showInList=true`.

---

## C. Migration & permissions

- **1 migration** : table `CustomFieldDefinition` + enums `CustomFieldEntity`/`CustomFieldType` +
  3 colonnes `customData Json?` (TransportOrder/Shipment/Load). Aucun nouveau statut, aucune
  modification de state machine (règle 2 intacte).
- **Aucune nouvelle permission** : config (règles + définitions de champs) sous
  `core.modules.manage` ; lecture/écriture des valeurs sous les permissions
  `transportation.*` existantes de chaque entité.

---

## D. Tests

- **Unit (`@pulsar/shared`)** :
  - `validateCustomFields` (chaque type, required, clé inconnue, SELECT hors options, patch
    partiel).
  - `isValid`/`validateSettings` pour le nouveau type `string` (pattern + maxLength).
  - `resolveSettings` avec les nouveaux descripteurs (défauts == comportement actuel).
- **e2e `tms-configurable`** (DB seedée) :
  - **Règles** : `requireTendering=REQUIRED` bloque le dispatch sans tender ACCEPTED ;
    `DISABLED` refuse la création de tender ; `podRequiredBeforeCompletion=true` bloque la
    complétion sans POD ; `bolRequiredBeforeDispatch=true` bloque le dispatch sans BOL ;
    `windowCoherence=LENIENT` renvoie un `windowWarnings` au lieu d'un 400 ;
    préfixe custom (`documentPrefixTransportOrder='ORD'`) appliqué au prochain numéro, compteur
    non réinitialisé.
  - **Champs personnalisés** : définir un champ `SELECT` requis → créer un ordre sans valeur =
    400 → avec valeur hors options = 400 → avec valeur valide = 201 et `customData` présent dans
    la projection GET → isolation tenant (les définitions d'un tenant B ne fuient pas).
  - Défauts : sans aucun réglage ni champ défini, tous les parcours existants restent verts
    (rétro-compat).

---

## E. Découpage d'implémentation (aperçu — détaillé dans le plan)

1. `@pulsar/shared` : type `string` + descripteurs de préfixe + enums custom fields +
   `validateCustomFields` + tests unitaires. Rebuild shared (règle 7).
2. `packages/database` : migration (table + colonnes + enums), regen, reseed.
3. API règles : consommation des 5 réglages aux points d'application + `SequencesService`
   configurable.
4. API custom fields : endpoints définitions + acceptation/validation `customData` dans les DTOs +
   projections.
5. Web : type `string` dans `ModuleSettings`, éditeur de définitions, `<CustomFieldInputs>`,
   affichage liste/détail.
6. e2e `tms-configurable` + vérification navigateur.
