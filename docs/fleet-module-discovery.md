# Module Fleet — Document de découverte

> Statut : découverte / cadrage pré-implémentation.
> Clé de module : `fleet` (réservée dans `packages/shared/src/modules.ts`, `available: false`).
> Référence d'audit : `docs/audit-tms-2026-06-10.md` §13.

---

## 1. Périmètre proposé

### Registre d'actifs interne

Le schéma actuel contient déjà les modèles `Vehicle`, `Trailer` et `Driver`.
La nullabilité de `carrierId` sur ces trois modèles est la marque d'un actif
interne : un tracteur sans `carrierId` appartient à la flotte propre du tenant,
un chauffeur sans `carrierId` est un employé direct. Le module Fleet étend ce
registre — il ne le duplique pas.

L'extension couvre les champs absents aujourd'hui : kilométrage courant,
prochain entretien prévu, date d'expiration de la plaque, date du dernier
contrôle technique. Ces champs enrichissent `Vehicle` et `Trailer` sans casser
les relations existantes avec `Load`.

### Maintenance préventive par échéancier

La valeur `MAINTENANCE` de l'enum `AssetStatus` existe déjà mais n'est jamais
pilotée automatiquement. Le module Fleet y introduit une logique d'échéancier :
chaque plan de maintenance définit un seuil de déclenchement soit kilométrique
(ex. : vidange toutes les 25 000 km), soit temporel (ex. : inspection annuelle),
soit les deux (le premier atteint déclenche l'ordre). Quand le seuil est
approché, le système émet une notification et crée un ordre de travail.

### Conformité (immatriculations, inspections, certifications)

Les flottes propres sont soumises à des obligations réglementaires périodiques :
renouvellement de plaques, inspections SAAQ/CVSA, certifications de transport de
matières particulières. Le module Fleet gère un registre de ces obligations avec
une date d'expiration et une alerte configurable (ex. : 30 jours avant). Chaque
obligation peut référencer un document existant (rapport d'inspection, certificat
numérisé) via le mécanisme `Document` de la plateforme.

---

## 2. Esquisse de modèles Prisma

Cette section décrit les modèles en prose. Aucun code ni migration n'est inclus ;
ils seront produits lors de l'implémentation.

### MaintenancePlan

Un plan de maintenance est associé à un actif — `Vehicle` ou `Trailer`. Deux
stratégies de liaison sont envisageables :

**Option A — polymorphisme léger (assetType + assetId)**

Un champ `assetType` (valeurs `VEHICLE` | `TRAILER`) et un champ `assetId`
(identifiant cuid) permettent de pointer vers n'importe quel type d'actif avec
une seule table. Prisma ne supporte pas les foreign keys polymorphes nativement,
mais l'intégrité peut être assurée au niveau applicatif (l'`OwnershipService`
vérifie la combinaison type+id). L'avantage est la simplicité du modèle : une
seule relation `MaintenancePlan → actif`. L'inconvénient est l'absence de
contrainte référentielle en base, ce qui complique la détection d'orphelins et
les jointures directes.

**Option B — deux FK nullables (`vehicleId?` + `trailerId?`)**

Deux clés étrangères optionnelles, avec une contrainte applicative (exactement
l'une des deux est non nulle). Prisma gère les foreign keys nativement ; les
jointures sont directes et les orphelins sont impossibles en base. Le schéma est
légèrement plus verbeux, et chaque requête de liste doit inclure les deux
relations. Cette approche suit le précédent déjà posé dans `Rate`
(`carrierId?` + `customerId?`).

**Recommandation** : Option B. La cohérence référentielle garantie en base
l'emporte sur la légèreté syntaxique, et le précédent de `Rate` montre que la
convention est déjà établie dans le projet. L'intégrité applicative (une seule FK
renseignée) est vérifiable par une simple validation dans le DTO de création.

Les autres colonnes du plan : `tenantId`, un libellé, un type de déclenchement
(`KM` | `TIME` | `BOTH`), un seuil en kilomètres (`thresholdKm`), un seuil en
jours (`thresholdDays`), un délai d'alerte avant déclenchement, une indication
de récurrence (si oui, le plan recrée un ordre à chaque clôture).

### MaintenanceWorkOrder

Un ordre de travail est créé à partir d'un plan (ou manuellement). Il porte le
statut de la progression : `OPEN → IN_PROGRESS → DONE` (avec `CANCELLED` comme
sortie latérale). À la création, le service passe l'actif concerné en statut
`AssetStatus.MAINTENANCE` ; à la clôture en `DONE`, l'actif revient en
`AVAILABLE`. Ce pilotage du statut de l'actif est la jonction principale entre
le module Fleet et le TMS existant.

Colonnes : `tenantId`, `planId` (nullable si ordre manuel), `vehicleId` /
`trailerId` selon l'actif, `description`, `scheduledAt`, `completedAt`,
`technicianNotes`, `odometer` (kilométrage relevé à la clôture), statut.

La séquence d'état (`OPEN → IN_PROGRESS → DONE`) suivra la convention des
machines d'état de `packages/shared/src/workflows`, comme pour les ordres de
transport et les chargements.

### ComplianceItem

Chaque obligation réglementaire est un enregistrement avec : `tenantId`, type
(`REGISTRATION` | `INSPECTION` | `CERTIFICATION` | `OTHER`), référence libre
(numéro de certificat, numéro de plaque), `vehicleId` / `trailerId` selon l'actif
(même approche deux FK nullables), `issuedAt`, `expiresAt`, `alertDaysBeforeExpiry`
(défaut 30), et un `documentId` optionnel pointant vers un `Document` existant
(rapport d'inspection scanné, certificat PDF). Un job planifié lit les items dont
`expiresAt` est dans la fenêtre d'alerte et émet des `Notification` de niveau
`WARNING` aux utilisateurs avec la permission `fleet.compliance.read`.

---

## 3. Permissions pressenties

Les clés suivantes seraient ajoutées dans `packages/shared/src/permissions.ts`
et rattachées au module `fleet` :

| Clé                       | Description                                                    |
| ------------------------- | -------------------------------------------------------------- |
| `fleet.assets.read`       | Consulter la liste et le détail des véhicules/remorques/chauffeurs internes |
| `fleet.assets.manage`     | Créer, modifier, archiver des actifs de flotte propre          |
| `fleet.maintenance.read`  | Consulter les plans de maintenance et les ordres de travail    |
| `fleet.maintenance.manage`| Créer des plans, ouvrir/clore des ordres de travail            |
| `fleet.compliance.read`   | Consulter les items de conformité et leurs dates d'expiration  |
| `fleet.compliance.manage` | Créer et mettre à jour des items de conformité, attacher des documents |

Comme pour les modules existants, chaque rôle système (`admin`, `dispatcher`,
`driver`) recevrait un sous-ensemble de ces permissions défini dans le seed.

---

## 4. Intégration à l'existant

### AssetStatus.MAINTENANCE piloté par les ordres de travail

Aujourd'hui, `AssetStatus` possède les valeurs `AVAILABLE`, `IN_SERVICE`,
`MAINTENANCE` et `RETIRED`. La valeur `MAINTENANCE` n'est jamais assignée par la
logique applicative — elle peut être mise à la main via l'API de mise à jour d'un
actif. Le module Fleet donne à cette valeur un sens opérationnel : la transition
vers `MAINTENANCE` est déclenchée par la création d'un `MaintenanceWorkOrder`, et
la transition vers `AVAILABLE` par sa clôture. La machine d'état de l'actif
devient pilotée, ce qui permet au TMS de refuser d'affecter un véhicule en
maintenance à un chargement.

### Actifs sans carrierId : candidats naturels au module Fleet

Le commentaire du schéma (`// null = internal fleet driver`) indique que la
nullabilité de `carrierId` a été pensée dès le départ pour la flotte propre.
Tous les `Vehicle`, `Trailer` et `Driver` où `carrierId IS NULL` sont les actifs
sur lesquels le module Fleet opère. Les plans de maintenance et les items de
conformité ne s'appliquent qu'à ces actifs ; tenter d'en créer sur un actif lié
à un transporteur externe retournerait une erreur de validation.

### Recette « Adding a business module » applicable telle quelle

Le guide de `CLAUDE.md` (section « Adding a business module ») s'applique sans
adaptation :

1. La clé `fleet` est déjà dans `MODULE_CATALOG` — il suffit de passer
   `available: true`.
2. Les permissions seront ajoutées dans `packages/shared/src/permissions.ts`.
3. Les nouveaux modèles (`MaintenancePlan`, `MaintenanceWorkOrder`,
   `ComplianceItem`) recevront `tenantId` et les index requis ; une migration
   et un reseed seront nécessaires.
4. Les contrôleurs seront créés dans `apps/api/src/modules/fleet/` avec
   `@RequireModule(MODULE_KEYS.FLEET)` au niveau classe.
5. La navigation web sera conditionnée sur
   `$auth.tenant.enabledModules.includes('fleet')`.
6. L'activation par tenant se fait via `PATCH /api/v1/modules/fleet`.

### Documents via DocumentsService

Les pièces jointes aux items de conformité (rapports d'inspection, certificats)
passent par `DocumentsService.upload/download` avec `entityType = 'compliance-item'`
et `entityId = <ComplianceItem.id>`. La règle 12 de `CLAUDE.md` s'applique : le
code du module Fleet ne touche jamais directement le stockage.

---

## 5. Questions ouvertes

### Coûts internes — comparaison flotte propre vs affrètement

L'audit TMS (`docs/audit-tms-2026-06-10.md` §13) identifie explicitement l'absence
de coûts internes comme le principal écart du module Fleet : « la comparaison
flotte propre vs affrètement est impossible ». Pour combler cet écart, il faudrait
un modèle de coût interne couvrant a minima l'amortissement (coût d'acquisition /
durée de vie estimée), le carburant (consommation théorique × prix unitaire × km
parcourus) et la maintenance (coût réel saisi à la clôture de chaque ordre de
travail). Ces données permettraient un coût par km de la flotte propre, comparable
aux tarifs transporteurs enregistrés dans `Rate`. Toutefois, la complexité de ce
calcul — en particulier l'amortissement et la gestion du prix du carburant dans le
temps — est significative et dépasse probablement le périmètre d'une v1. Une
question à trancher : doit-on prévoir les colonnes dans les modèles dès v1 (sans
logique de calcul) pour éviter une migration ultérieure invasive, ou reporter
complètement jusqu'à ce qu'un besoin client soit confirmé ?

### Heures de service chauffeurs

La conformité réglementaire des conducteurs (règles HOS — Hours of Service — au
Canada et aux États-Unis) est un domaine distinct de la maintenance des actifs.
Elle implique un journal de bord par chauffeur, des règles de calcul complexes
(fenêtres de 70h/8j, pauses obligatoires), et une intégration avec les ELD
(Electronic Logging Devices). Ce périmètre est probablement hors scope pour une
v1 du module Fleet, qui se concentrerait sur les actifs matériels. À confirmer
selon la cible marché : un opérateur de flotte longue distance en a besoin
immédiatement ; un distributeur régional peut s'en passer longtemps.

### Télématique — le registre Integration comme point d'accroche

Le modèle `Integration` (clé exemple : `telematics-samsara`) est le point
d'accroche naturel pour les données de télématique (position GPS, kilométrage
réel, alertes moteur). Si une intégration télématique est activée, le module
Fleet pourrait consommer les événements entrants (via webhook entrant ou polling)
pour mettre à jour le kilométrage des véhicules et déclencher automatiquement des
plans de maintenance par seuil. Cela nécessiterait un handler dans le module Fleet
qui s'abonne aux événements de l'intégration concernée. La question ouverte est
de savoir si le bus interne d'événements (aujourd'hui absent — les webhooks sont
sortants uniquement) doit être introduit pour découpler la télématique du module
Fleet, ou si une dépendance directe est acceptable en v1.
