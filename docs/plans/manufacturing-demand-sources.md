# MRP M2.2a — commandes clients et consommation des prévisions

> Suite livrée : [M2.2b1 + M7a](./manufacturing-mrp-units-ai.md) ajoute les ratios
> commerciaux capturés et le worker MRP gouverné. Le présent document conserve
> le contrat et les preuves de la tranche initiale 1:1.

Livraison locale du 2026-09-15, après M2.1. Ce lot connecte CRM, Fabrication et
WMS au calcul PlaniAdvance; il ne termine pas M2.2 ni le MRP complet. Le bureau,
le shell, les panneaux latéraux et les composants Pulsar sont conservés.

## Parcours opérateur

1. Configurer les articles WMS et leurs règles MRP par entrepôt.
2. Dans **Besoins matières → Prévisions**, saisir un article, une quantité et une
   période UTC. Le besoin résiduel sera placé à la fin de cette période.
3. Confirmer une commande CRM avec ses lignes. Depuis sa fiche, ouvrir les
   besoins matières, ou utiliser **Demande → Relier une commande client**.
4. Choisir la ligne, son article WMS exact, son entrepôt et sa date de besoin.
   Confirmer explicitement que **1 unité commerciale = 1 unité de base WMS**.
   La quantité vient du serveur CRM : elle ne se saisit pas dans ce formulaire.
5. Si cette commande réalise une prévision, sélectionner cette prévision du
   même article/site, dont la période contient la date du besoin. Sans sélection,
   la demande est indépendante et s'ajoute aux autres besoins.
6. Calculer. Les propositions conservent leur explication par source; le résultat
   garde une photographie des consommations. L'onglet Prévisions affiche la
   couverture actuelle, distincte de celle d'un ancien calcul.

Exemple, même article et même unité : prévision 100, commande liée 30. Tant que la
commande est confirmée, le moteur reçoit **30 fermes à leur date + 70 prévus en
fin de période**, pas 130. Si la commande est exécutée, il ne reste que 70 à
planifier; si elle est annulée, la prévision revient à 100. Ce comportement
suppose que l'état CRM global représente bien l'exécution de toutes ses lignes.

## Contrats de données et de calcul

- `MrpEntry.kind=FORECAST` ajoute `forecastStart`; `dueDate` est la fin de période.
  Pas de calendrier commercial ou de répartition quotidienne implicite.
- `forecastId` relie une demande ferme manuelle ou CRM à une seule prévision.
  Même tenant/site/article, prévision active à l'affectation, date incluse dans la
  période. Une prévision ne consomme pas une autre prévision; SUPPLY ne consomme
  rien. Réduire la période pour exclure une demande active est refusé (409).
- La consommation utilise `deriveDemandCoverage` dans `@pulsar/shared`, pure,
  déterministe (date puis ID) et exacte en millièmes via BigInt. Aucun cumul entre
  articles/sites/unités. Les commandes dépassant la prévision restent entières;
  seule la consommation est plafonnée à la quantité prévue.
- Une prévision inactive ne supprime jamais les besoins fermes. Désactiver une
  demande supprime sa demande ferme ET restitue sa consommation de prévision.
- `sourceSalesOrderLineId` est unique par tenant, tous sites confondus. Une ligne
  n'est donc pas importable deux fois, même si son rattachement est désactivé.
  Source/article/site sont immuables; seules date, prévision et activation sont
  éditables par le parcours dédié, avec version optimiste.
- Création seulement depuis une commande CONFIRMED. Quantité positive, au plus
  1 milliard, 3 décimales maximum; aucun arrondi silencieux. L'instantané capture
  quantité, identité produit/commande et reconnaissance de l'unité WMS.
- À chaque calcul, les lignes CRM sont relues dans le snapshot transactionnel
  RepeatableRead avec les autres entrées : CONFIRMED = besoin ferme;
  FULFILLED/INVOICED = prévision consommée mais plus de besoin ferme;
  CANCELLED = ni besoin ni consommation. Un changement de quantité/produit/source
  non conforme à l'instantané bloque le calcul; ne pas réécrire sa provenance.
- Tous les liens actifs du site participent à la couverture et à l'empreinte,
  même au-delà de l'horizon demandé. Seuls les flux datés au plus tard à l'horizon
  sont envoyés au moteur. Cette approche conservatrice peut marquer un calcul
  périmé lorsqu'une source future change.
- `MrpRun.sourceMetadata` conserve couverture et états CRM; son hash participe
  à la fraîcheur. L'historique n'est jamais recalculé en place. Les besoins sont
  précomposés côté Pulsar; le contrat privé PlaniAdvance MRP v1 reste inchangé.

## API, sécurité et concurrence

Toutes les routes ci-dessous sont sous `/api/v1/manufacturing/mrp` :

- `GET sales-sources` : lignes confirmées paginées/recherchables, filtre optionnel
  `salesOrderId`; projection sans prix ni dossier client complet.
- `POST sales-demands` et `PUT sales-demands/:id` : choix explicites et versions
  `expectedSourceUpdatedAt`, `expectedOrderUpdatedAt`, plus `expectedUpdatedAt`
  sur l'édition. `acknowledgeUnits: true` obligatoire; quantité absente du DTO.
- La lecture exige manufacturing.read, wms.read, crm.read et les trois modules
  actifs. L'écriture exige manufacturing.manage, wms.read et crm.read. Les FK sont
  contrôlées par OwnershipService et relues sous le verrou tenant partagé.
- Un workspace contenant un lien CRM, même inactif, exige CRM actif + crm.read.
  Un historique qui contient des sources CRM garde cette exigence, même après
  désactivation des liens courants. Pas de contournement par un ancien calcul.
- Une répétition identique de création renvoie le même rattachement; une autre
  affectation de la même ligne renvoie 409. Verrou + contrainte SQL protègent les
  créations concurrentes. Les modifications sont versionnées et auditées.
- Les writers de lignes CRM et les transitions manuelles de commande prennent
  le même verrou tenant. Le writer relit DRAFT dans la transaction, et la
  confirmation conserve la state machine et le claim conditionnel : aucune
  édition de ligne ne peut passer après confirmation avec une ancienne lecture.
- Après réponse incertaine, le panneau garde la saisie et interdit un nouvel
  envoi. Fermer, actualiser et inspecter les demandes avant de reprendre.

## Migration et reprise

Migration additive `20260915200000_mrp_demand_sources` : nouvelle valeur d'enum,
colonnes nullable, relations et unicité. Les entrées antérieures restent telles
quelles; aucune commande n'est automatiquement importée et aucune saisie manuelle
n'est identifiée par heuristique. Désactiver une ancienne copie manuelle de la
même commande avant d'utiliser son nouveau lien. Pas de seed/reset/backfill.

Les nouveaux calculs enrichissent leur empreinte; les historiques antérieurs
restent lisibles et peuvent être marqués à recalculer. Le projet PlaniAdvance
original et son moteur vendored ne sont pas modifiés par ce lot.

## Vérification

- 40 tests HTTP PostgreSQL ciblés CRM/MRP/APS, avec le vrai bridge Python séparé
  du serveur dev : concurrence, versions, permissions/tenants, quantité source,
  annulation/exécution, absence de double compte et historique figé.
- 652 tests shared, dont 6 sur la consommation exacte des prévisions.
- 283 tests unitaires API. Les 12 tests UI BOM/OF/revue APS restent couverts;
  la suite MRP couvre maintenant 10 parcours, dont 4 nouveaux CRM/prévisions.
- Build complet et typecheck web réussis (0 erreur, 12 avertissements Svelte
  préexistants hors lot). Migration appliquée aux bases locales test/dev sans
  reset; comparaison Prisma/BD de test vide.
- Les vérifications UI utilisent des réponses API contrôlées; les calculs et
  écritures réels sont vérifiés séparément par les tests HTTP. Ne pas présenter
  ces fixtures comme un scénario usine complet ni comme des données utilisateur.

## Suite et limites explicites

1. **M2.2b** : conversions d'unités contrôlées et mappings réutilisables
   produit CRM/article WMS, validité des versions, sites des postes/calendriers.
   Aucun rapprochement sur nom/SKU seul; aucune conversion masse/volume implicite.
2. **M3** : propositions → demandes d'achat/OF transactionnels et idempotents,
   avec revue humaine, puis réceptions partielles reliées au WMS.
3. **M4–M6** : boucle APS par site, réservations, exécution partielle par ligne,
   matière consommée/produite réelle, lots, recettes/batchs et rendements.

Il n'y a ici ni quantité CRM restante partielle, ni prévisions glissantes
automatiques, ni partage d'une ligne entre plusieurs entrepôts, ni réaffectation
de la provenance après usage. Aucun stock, achat, OF ou message externe n'est créé
par un calcul. Les agents MRP viendront via le registre et ProposedAction existants.
