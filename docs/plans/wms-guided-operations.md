# WMS — réceptions et préparations guidées

Date : 2026-09-14. Branche : `codex/wms-guided-operations`.
Base : `3cd6865`, poste de travail WMS visuel.

## Résultat métier

Les fiches `/wms/receiving/:id` et `/wms/picking/:id` partagent une interface
spécialisée : articles et emplacements → vérification → mouvement de stock confirmé.
Le bureau d'applications, le shell et les composants communs sont conservés.
Le skill `redesign-existing-projects` a guidé l'audit et le choix de panneaux
contextuels plutôt que de formulaires qui déplacent la navigation.

- Cartes de lignes : SKU, nom, quantité avec unité, emplacement et zone.
- Préparation : stock physique et besoin cumulé du même article/emplacement,
  couverture visuelle et manque explicite. Ce n'est pas un pourcentage de travail accompli.
- Ajout et modification en panneau, suppression confirmée, recherche serveur des
  articles actifs et des emplacements actifs du seul entrepôt concerné.
- Confirmation finale portant sur TOUT le document, même quand ses lignes sont filtrées.
- Consignes, chronologie, retour au workspace du site, dossiers Cour et contexte
  de l'expédition liée conservés. Aucun changement implicite du transport.
- Lecture seule sans actions de mutation. Documents validés/annulés non modifiables.

L'ajout ou la correction d'une ligne ne change aucun stock. Les mouvements restent
atomiques au niveau du document : réception DRAFT→POSTED et préparation
OPEN/PICKED→COMPLETED. Aucun nouveau statut, prélèvement partiel ou réservation.

## Contrats API

Préfixe `/api/v1`. Module WMS obligatoire; `wms.read` pour les lectures et
`wms.manage` pour les mutations. Le tenant vient toujours de l'identité authentifiée.

- GET `/wms/receipts/:id` et `/wms/pick-orders/:id` : contrat existant enrichi avec
  unités, activité des références, site/zone et `readiness` calculée à la lecture
  dans une transaction RepeatableRead. Types browser-safe dans
  `packages/shared/src/wms/documents.ts`.
- `readiness` : date de lecture, applicabilité, possibilité de valider, lignes
  bloquées et contrôles par ligne. Le besoin est agrégé en Decimal par article/bin.
  Un document historique n'est pas réévalué contre le stock courant.
- GET `/wms/choices/items[/:id]` et `/wms/sites/:siteId/bins[/:id]` : recherches
  paginées (maximum 100/page), tenant/site-scopées. Les listes excluent les références
  inactives; le GET par identifiant permet d'expliquer une ancienne sélection inactive.
- PATCH `/wms/{receipts|pick-orders}/:id/lines/:lineId` : nouvelle correction de
  ligne complète (article, emplacement et quantité); mêmes règles que l'ajout.
- `expectedUpdatedAt` optionnel sur ajouts/corrections de lignes, mise à jour des
  métadonnées de réception et actions finales/annulation. DELETE ligne le reçoit
  en query string. Le nouveau client le transmet toujours; conflit ⇒409.
- Audit ajouté aux créations, corrections et suppressions de lignes via les
  contrôleurs existants. Audits de statut et événements métier conservés.

## Intégrité et concurrence

Une course existait entre la lecture des lignes et leur validation : une édition
pouvait arriver après le snapshot utilisé pour poster le stock. Tous les writers
de ces documents prennent maintenant le verrou transactionnel du tenant AVANT
de relire le document et ses lignes. Ils partagent l'ordre de verrouillage du
writer de stock et de la configuration des emplacements.

L'ajout, la correction et la suppression vérifient le statut sous verrou et
avancent la version `updatedAt` du parent de façon monotone à la milliseconde.
Les anciens clients sans version restent protégés contre une modification après
validation; le nouveau client refuse aussi les confirmations d'un dossier périmé.

Le serveur revalide les références dans la transaction : article et emplacement
actifs, entrepôt WAREHOUSE, même site que le document, quantité positive avec trois
décimales maximum. Une ligne étrangère au parent ne peut être modifiée/supprimée.
Les références entrantes passent par `OwnershipService` pour les nouvelles écritures
de lignes. Les anciens documents invalides sont signalés puis refusés à la validation.

Les transitions utilisent toujours les machines d'état et leur claim conditionnel.
`InventoryService.postMovement` reste l'unique writer des soldes et du registre,
dans la même transaction. Un manque de stock sur une ligne annule TOUTE l'opération.
Le calcul de disponibilité dans le dossier est informatif : le serveur revérifie
le stock au moment d'agir; les autres préparations ne le réservent pas.

Le verrou reste grossier, par tenant; aucun test de charge n'est revendiqué.
Cette protection ne sérialise pas tous les référentiels de la plateforme, notamment
toutes les modifications d'articles/localisations hors du workflow WMS.

## Erreurs et ergonomie

Un conflit conserve la saisie. Fermer le panneau demande d'abandonner le brouillon;
pendant l'envoi, fermeture, saisie et deuxième envoi sont bloqués. Les réponses
tardives des contrôles de références ne remplacent pas la sélection actuelle.

En cas de réponse incertaine (réseau/5xx), aucun retry automatique : actualiser et
vérifier le résultat avant d'agir à nouveau. Il n'y a pas de clé d'idempotence durable
ajoutée. Le contrôle absent échoue de manière fermée : validation désactivée,
erreur visible, actualisation possible. Un échec de lecture ne devient pas un faux
document vide. Les quantités historiques sont étiquetées comme validées/prévues.

## Validation

- 83 tests HTTP réussis sur 6 suites, dont 9 nouveaux cas guidés : isolation,
  permissions, pagination des choix, versions, mauvaises références, quantité
  fractionnaire et besoin cumulé, rollback stock, édition/validation concurrentes.
- 10 tests unitaires API WMS, 21 tests shared WMS et 34 tests web réussis.
- **176 tests UI réussis ensemble (3,4 min, 2 workers)** : 13 nouveaux scénarios
  guidés et 163 régressions WMS/Cour/Finance/CRM/navigation, tablette et mobile.
  Quantités et unités, blocages, correction, suppression, confirmation globale,
  version, conservation sur conflit, double envoi, fermeture en cours d'écriture,
  réponses incertaines et lecture seule couverts.
- Captures desktop et 390 px inspectées : lignes, actions de validation en bas de
  page et panneau d'édition contenus, références lisibles, sans débordement horizontal.
- Package shared reconstruit, build et typecheck API réussis.
- Svelte : **0 erreur et 12 avertissements préexistants** dans cinq fichiers hors de ce lot.
- Build SPA de production réussi (`adapter-static`, 1 min 17 s).

La première passe HTTP avait une attente de test incorrecte (double POST attendu
400 plutôt que le 409 du claim existant); corrigée. La première passe UI élargie
a révélé un sélecteur ambigu entre les deux boutons Fermer du panneau : le test
vérifie maintenant que les deux sont désactivés. Les assertions métier sont conservées.

Tests navigateur : connexion locale réelle puis données WMS contrôlées. Tests HTTP :
vraies transactions sur la base de test dédiée. Aucun stock ni dossier fictif ajouté
à la base de développement. Jest signale encore des handles asynchrones ouverts
après les suites HTTP; cette dette préexistante n'est pas corrigée ici.

Commandes (HTTP avec `DATABASE_URL` de test dédié et `EMAIL_DRIVER=log`) :

```sh
pnpm --filter @pulsar/api test:e2e --testPathPattern='wms-guided-operations|wms-workspace|yard-dossiers|configurable-wms-yard-fleet|wms-module|wms-fulfillment'
pnpm --filter @pulsar/api test --runInBand inventory.service.spec.ts receiving.service.spec.ts picking.service.spec.ts
pnpm --filter @pulsar/shared test -- src/wms
pnpm --filter @pulsar/web test
pnpm --filter @pulsar/web typecheck
pnpm --filter @pulsar/api build
pnpm --filter @pulsar/web build
pnpm --filter @pulsar/web test:e2e wms-guided-operations.spec.ts wms-workspace.spec.ts yard-dossiers.spec.ts yard-workspace.spec.ts bank-csv-import.spec.ts finance-connected-flow.spec.ts finance-audit.spec.ts billing-screens.spec.ts record-screens.spec.ts fulfillment.spec.ts screen-redesign.spec.ts screen-surfaces.spec.ts workspace.spec.ts crm-pipelines.spec.ts crm-sequences.spec.ts journeys.spec.ts responsive.spec.ts loads-list.spec.ts control-center.spec.ts --workers=2 --reporter=line
```

## Suite et limites

1. Rangement traçable : journal contextualisé, idempotence durable du MOVE puis
   sélection paginée sur toutes les anciennes surfaces de mouvement.
2. Réception/préparation partielles et scans : concevoir quantités attendues/réelles,
   unité immuable ou conversion explicite, écarts, allocations et réservations
   avant d'ajouter des coches de progression ou un mode hors ligne.
3. Cohérence des lignes WMS et expéditions reliées à la Cour/TMS; une association
   reste un lien de contexte, pas une preuve de réception/livraison.
4. Flotte puis Fabrication : disponibilité/maintenance et postes/flux spécialisés.
5. Agents contextuels via le registre et `ProposedAction`; pas de nouvel outil,
   d'autonomie ni d'effet externe dans ce lot.

Pas de migration, dépendance ajoutée, modification de `.env`, push GitHub ou
déploiement OVH. Application locale ouverte sur `/wms`; Acme n'a actuellement aucun
site WAREHOUSE configuré. Configurer ses sites et emplacements avant une démonstration
avec ses propres données. Les fixtures des captures ne sont pas des données Acme.
