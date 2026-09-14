# Cour, transport et entrepôt — dossiers connectés

Lot du 14 septembre 2026. Branche `codex/yard-connected-dossiers`, basée sur
`b038e9d` (poste de travail visuel Cour & quais).

## Résultat et parcours

Depuis le plan de cour ou le planning des quais, ouvrir une visite ou un
rendez-vous puis **Dossiers opérationnels → Relier un dossier**. Choisir un type,
rechercher un numéro/référence, sélectionner le dossier et confirmer. Les liens
ouvrent les fiches existantes; ces fiches permettent de revenir au passage en
cour, avec le site et le rendez-vous ou la visite présélectionnés.

Trois catégories : chargements TMS, réceptions WMS et préparations WMS. Le bureau
d’applications et les panneaux communs sont conservés. La compétence de refonte a
guidé l’intégration dans les panneaux existants, les erreurs locales, les états
vides/inaccessibles distincts et la continuité de navigation, sans nouveau système
de fenêtres ni dépendance UI.

Retirer un lien ne supprime jamais le dossier. Un lien ne valide pas une réception,
ne prélève pas de stock et ne termine pas un chargement. Aucun connecteur, envoi
externe ou outil d’agent supplémentaire n’est déclenché.

## Modèle et invariants

Table additive `YardDossierLink`, migration
`20260914210000_yard_dossier_links`. Deux contraintes SQL imposent exactement une
source (`visitId` XOR `appointmentId`) et exactement une cible (`loadId`,
`receiptId` ou `pickOrderId`). Toutes sont des FK réelles, avec suppression
restreinte et index tenant-scopés; six contraintes uniques protègent les doublons.

- Une visite sans rendez-vous porte ses propres liens.
- Une visite liée à un rendez-vous utilise **la liste du rendez-vous**, sans copie
  au check-in. Ajouter depuis l’un ou l’autre donne la même liste.
- Une ancienne visite incohérente liée à un rendez-vous d’un autre site est
  refusée explicitement, sans correction automatique des données historiques.
- Les écritures sont sérialisées par site avec le même verrou `Location` que les
  opérations Yard, puis le contexte est relu dans la transaction.
- Visite modifiable uniquement `CHECKED_IN`/`ASSIGNED`; rendez-vous uniquement
  `SCHEDULED`/`ARRIVED` et sans visite déjà partie. Un départ fige donc la liste
  commune, même si le rendez-vous est encore `ARRIVED`.
- Ajout idempotent; retrait répété sans effet. Ajouts/retraits effectifs audités
  comme `yard-dossier-link`, avec acteur, source et cible.
- À l’arrivée, sens et transporteur sont repris du rendez-vous lorsque absents.
  Un sens explicitement contradictoire est refusé. Les deux formulaires d’arrivée
  affichent le sens hérité et empêchent sa modification tant que le rendez-vous
  est sélectionné.

## Compatibilité des dossiers

| Cible       | Conditions lors de la liaison                                                                                                 |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Chargement  | Non annulé, avec expédition non annulée ou arrêt de route sur le site; livraison pour une entrée, enlèvement pour une sortie. |
| Réception   | Non annulée, même entrepôt, entrée ou opération « autre ».                                                                    |
| Préparation | Non annulée, même entrepôt, sortie ou opération « autre ».                                                                    |

Une cible déjà traitée reste admissible tant que le passage en cour est ouvert :
la liaison décrit un contexte, pas une instruction d’exécution. Un dossier annulé
ou devenu incompatible **après** la liaison reste visible avec un avertissement
calculé à la lecture. Aucun stock, coût figé, statut métier ou `PickOrder.shipmentId`
n’est modifié.

Attention : plusieurs dossiers reliés au même passage ne prouvent pas que les
lignes de chaque réception/préparation correspondent à chaque chargement. Ce lot
ne remplace pas la relation expédition/préparation existante, ni une traçabilité
ligne à ligne. La compatibilité est vérifiée à l’ajout et réévaluée à la lecture;
les opérations TMS/WMS ne sont pas verrouillées par la liaison Yard.

## API et droits

Préfixe `/api/v1/yard/dossiers`, module `yard` activé et permission `yard.read`
sur toutes les routes. `source` vaut `visit` ou `appointment`; `kind` vaut `load`,
`receipt` ou `pick-order`.

| Méthode / route                          | Usage et droits supplémentaires                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| `GET /:source/:id`                       | Contexte; catégories non autorisées explicitement indisponibles, sans ID ni compteur caché. |
| `GET /:source/:id/candidates?kind=…&q=…` | Recherche compatible, avec droit de lecture de la cible.                                    |
| `POST /:source/:id/links`                | `{ kind, targetId }`; `yard.manage` et lecture de la cible.                                 |
| `DELETE /:source/:id/links/:linkId`      | Même contrôle; retrait limité à cette source.                                               |
| `GET /related/:kind/:id`                 | Navigation inverse, avec lecture de la cible.                                               |

Pour les chargements : `transportation` activé + `transportation.planning.read`.
Pour les réceptions/préparations : `wms` activé + `wms.read`. Les FK d’écriture
passent par `OwnershipService`; le tenant vient du JWT, jamais du corps. Les
projections ne contiennent ni secret, ni token chauffeur, ni coût ou données
financières. Aucun import statique des modules WMS/TMS dans Yard.

Recherche côté serveur, 20 résultats et indicateur de troncature; maximum 100
associations par catégorie et par source. Lecture inverse limitée à 100, signalée
explicitement. La recherche de chargement porte sur son numéro; celle de WMS sur
numéro ou référence.

## UX et erreurs

- Choix explicite, confirmation d’ajout/retrait, aucune liaison par texte libre.
- Échec d’ajout : recherche et sélection conservées. Réessayer ne duplique pas
  l’association. Échec de retrait : le dossier reste affiché.
- Requêtes de recherche tardives ignorées; fermeture du panneau et actions Yard
  concurrentes bloquées pendant la confirmation et l’écriture du lien.
- Les erreurs du contexte Cour restent locales aux fiches TMS/WMS.
- Un lien profond peut ouvrir un rendez-vous historique hors de la fenêtre
  initiale du planning. Site absent ou visite d’un autre site : erreur explicite.
- Les droits serveur restent autoritaires même si la session UI n’est pas encore
  rafraîchie après un changement de rôle/module.

## Validation

- Migration additive appliquée sur les bases locales de développement et de test;
  Prisma généré, package database reconstruit. Aucun backfill de liens inventés.
- **81 tests HTTP réussis sur 7 suites** Yard/WMS, dont 12 nouveaux : isolation,
  permissions, modules désactivés, compatibilité, partage rendez-vous/arrivée,
  doublons concurrents, audit, retrait, départ, recherche, historique et
  contraintes de cardinalité SQL.
- **9 tests unitaires API Yard**, **27 shared Yard**, **34 web** réussis.
- Svelte : **0 erreur, 12 avertissements préexistants** hors de ce lot.
- Builds API et SPA de production réussis.
- **149 tests UI réussis (1,8 min, 2 workers)** dans la régression consolidée,
  dont 10 nouveaux scénarios de dossiers connectés et 15 scénarios du poste Yard.
  Confirmation/annulation, recherche tardive, saisie conservée, navigation
  aller-retour, rendez-vous historique, lecture restreinte et sens hérité sont
  vérifiés. Capture du nouveau panneau à 390 px inspectée, sans débordement.
- Un sélecteur trop strict du nouveau test de guérite a échoué lors de la première
  passe; corrigé vers le rôle accessible, puis les 149 scénarios ont été relancés
  et réussis ensemble. Aucune assertion métier n’a été supprimée.

Les scénarios navigateur utilisent une vraie connexion locale, des réponses
contrôlées et des écritures simulées. Les scénarios HTTP exécutent réellement les
mutations dans leurs tenants de la base de test dédiée. Aucun dossier de cour
fictif n’est créé dans la base de développement pour remplir l’interface.

Jest signale encore des handles asynchrones ouverts après les suites HTTP; le
processus termine avec code 0. Cette campagne n’est ni un test de charge ni une
validation de déploiement OVH.

Commandes principales :

```sh
pnpm --filter @pulsar/api test:e2e yard-dossiers.e2e-spec.ts yard-workspace.e2e-spec.ts yard-plan.e2e-spec.ts yard-module.e2e-spec.ts configurable-wms-yard-fleet.e2e-spec.ts wms-module.e2e-spec.ts wms-fulfillment.e2e-spec.ts
pnpm --filter @pulsar/api test --runInBand visits.service.spec.ts spots.service.spec.ts appointments.service.spec.ts
pnpm --filter @pulsar/shared test -- src/yard
pnpm --filter @pulsar/web test
pnpm --filter @pulsar/web typecheck
pnpm --filter @pulsar/api build
pnpm --filter @pulsar/web build
pnpm --filter @pulsar/web test:e2e yard-dossiers.spec.ts yard-workspace.spec.ts bank-csv-import.spec.ts finance-connected-flow.spec.ts finance-audit.spec.ts billing-screens.spec.ts record-screens.spec.ts fulfillment.spec.ts screen-redesign.spec.ts screen-surfaces.spec.ts workspace.spec.ts crm-pipelines.spec.ts crm-sequences.spec.ts journeys.spec.ts responsive.spec.ts loads-list.spec.ts control-center.spec.ts --workers=2 --reporter=line
```

HTTP : `DATABASE_URL` vers la base dédiée, `EMAIL_DRIVER=log`. Navigateur : API sur
3100, Vite sur 5173. Arrêter le processus API avant de régénérer Prisma sous
Windows si le moteur est verrouillé, puis relancer l’API compilée.

## Suite prioritaire et limites

1. **WMS visuel** : zones/bins, disponibilité et progression réception → rangement
   → préparation, accès aux quais depuis chaque étape.
2. **Cohérence guidée** : confronter les expéditions/lignes déjà liées et proposer
   les dossiers pertinents sans transformer une simple association en preuve.
3. **Planning des quais** : replanification contextuelle, horaires, durées et
   compatibilité des ressources; seuils de présence configurables.
4. **Agents** : lectures contextuelles puis propositions gouvernées via le registre
   et `ProposedAction`, après définition des outils et des plafonds. Aucun nouvel
   outil d’agent n’est exposé ici.

Les fiches WMS historiques chargent encore certains référentiels via les endpoints
TMS : le parcours UI d’un rôle WMS strict sans ces droits reste à découpler. Les
associations API de ce lot ne demandent, elles, que les droits explicités plus haut.
Le brouillon de recherche reste en mémoire; pas de promesse de temps réel,
d’offline, de création automatique de dossiers ou de compatibilité universelle
avec tous les métiers. Le statut de rendez-vous affiché dans le lien inverse ne
remplace pas l’état physique de sa visite.

Aucun push GitHub, déploiement OVH ou changement du `.env` dans ce lot.
