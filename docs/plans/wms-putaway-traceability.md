# WMS — rangement et journal des mouvements

Date : 2026-09-14. Branche : `codex/wms-putaway-traceability`.
Base : `f41c2f7`, réceptions et préparations guidées.

## Résultat métier

Le rangement est désormais un poste de travail dédié, relié au stock et aux
dossiers. Le bureau d'applications et le shell restent inchangés. Le skill
`redesign-existing-projects` a guidé la continuité des panneaux, la hiérarchie
quantité/source/destination et les états métier explicites, sans nouveau framework.

- `/wms/putaway` : file par entrepôt, recherche serveur et pagination; chaque
  ligne représente un article dans un emplacement de réception avec stock positif.
- Déplacement en panneau : destination recherchable du même site, quantité avec
  unité, note, confirmation portant sur le SKU et les deux emplacements.
- `/wms/movements` : registre paginé, types, acteur, date, unité, note, source et
  destination, liens vers les réceptions, préparations et inventaires tournants.
- Accès contextualisés depuis articles, inventaire, emplacement, entrepôt et
  fiches de réception/préparation. Les filtres de contexte et de recherche se cumulent.
- Même protection de reprise dans le panneau d'emplacement et l'ancien formulaire
  de déplacement de l'inventaire. Un utilisateur en lecture seule n'a pas d'action de stock.

Le rangement n'est **pas** une réservation ni une traçabilité par lot de réception.
Un mouvement manuel n'acquiert pas artificiellement un dossier d'origine. Aucune
somme ne mélange EA et KG. Un emplacement inactif avec du stock reste visible,
mais ne propose pas de déplacement tant qu'il est inactif.

## Contrats et intégrité

Préfixe `/api/v1`, module WMS obligatoire. Tenant issu de l'identité authentifiée.

| Endpoint | Contrat |
| --- | --- |
| `GET /wms/putaway` | `wms.read`, `locationId` entrepôt obligatoire, `q`, `page`; 30 lignes/page, lecture RepeatableRead. |
| `GET /wms/inventory/movements` | `wms.read`, `locationId`, `itemId`, `binId`, `type`, `refType`, `refId`, `search`, `page`, `pageSize`; pagination commune, ordre date/id décroissant. |
| `POST /wms/inventory/move` | `wms.manage`, corps existant + `operationKey` UUID v4 optionnel; retourne `movementId`, `createdAt`, `replayed`. |

Un filtre d'emplacement matche une entrée OU une sortie; site, article, document
et type sont ensuite combinés par ET. Les références item/bin/site sont contrôlées
par `OwnershipService` (400 si elles ne sont pas accessibles). Les dossiers sources
et acteurs sont résolus dans le tenant. La projection ne contient ni tenantId,
ni clé/fingerprint de reprise, ni identifiants ou secrets d'authentification.

La clé est unique sur `(tenantId, operationKey)`, stockée sur le mouvement lui-même.
Le fingerprint lie la clé à l'acteur, l'article, les emplacements, la quantité
normalisée Decimal, la note et le site éventuel. Réutiliser une clé pour un autre
contenu renvoie 409. Six requêtes concurrentes identiques produisent un seul mouvement.

Le verrou tenant est pris AVANT de rechercher un mouvement existant. Une demande
déjà enregistrée renvoie son résultat avant de revérifier les disponibilités : le
premier déplacement peut avoir vidé ou fait désactiver la source entre-temps.
Les guards de droits et de module s'appliquent aussi à cette reprise.

Pour une nouvelle demande, `InventoryService.postMovement` reste le SEUL writer :
registre et soldes dans la même transaction, stock négatif refusé. L'échec annule
aussi l'enregistrement de la clé. Pas de compteur ou de cache d'idempotence en mémoire.
L'audit métier est appelé seulement pour le premier succès; il conserve son
comportement best-effort existant, hors de la transaction du registre.

Chaque nouveau mouvement, tous types confondus, capture l'unité courante de
l'article dans `unitSnapshot`. Les anciennes lignes restent NULL; l'UI indique
explicitement « Unité actuelle · historique non figé ». Ni conversion ni backfill inventé.
Les noms, codes et libellés d'emplacements restent les références courantes.

## Reprise navigateur

Avant le premier POST, la demande exacte est conservée dans localStorage sous
`pulsar.wms.move.v1:<tenantId>:<userId>`, sans JWT ni mot de passe. Si cette écriture
échoue, aucun POST n'est envoyé. Une seule demande non résolue est autorisée dans
ce contexte navigateur; elle est restaurée après rechargement.

Un résultat réseau/5xx incertain fige la saisie. La bannière WMS « Vérifier et
reprendre » réutilise la clé et le corps originaux après confirmation humaine.
Si le serveur avait déjà commité, il ne déplace rien de plus. Sinon, il vérifie
et exécute cette demande exacte. Aucune reprise automatique et aucune nouvelle clé
générée pour résoudre une incertitude.

Une erreur métier certaine au premier envoi conserve le brouillon modifiable.
Une erreur lors d'une reprise conserve, par prudence, l'intention originale.
En cas de conflit persistant ou stockage corrompu, vérifier le journal et faire
diagnostiquer la demande; aucun bouton d'effacement aveugle n'est fourni. Une
annulation serveur explicite d'intention reste à concevoir. L'UI ne doit pas
promettre qu'une seconde opération créée avec une AUTRE clé est dédupliquée.

## Migration et démonstration locale

Migration additive `20260915010000_wms_movement_identity` : trois colonnes nullable,
un index unique tenant/clé, deux index tenant/emplacement/date. Appliquée aux
bases locales de développement et de test; Prisma régénéré, shared/database reconstruits.
Pas de modification de `.env`, pas de déploiement OVH ni push GitHub.

`node scripts/seed-wms-demo.mjs --create` crée via les services HTTP un scénario
**DÉMO WMS — Atelier de rangement**, uniquement contre localhost/loopback. Il ne
modifie aucun article/site existant et ne touche jamais directement les soldes.
Une relance sur le site existant ne change rien (vérifié). Une interruption à
mi-parcours nécessite une inspection : pas de reset, suppression ou reprise automatique.
Variables optionnelles : `PULSAR_API_URL`, `PULSAR_DEMO_TENANT`,
`PULSAR_DEMO_EMAIL`, `PULSAR_DEMO_PASSWORD`; ne pas journaliser leurs secrets.

Scénario livré dans le tenant local `acme` :

1. Ouvrir [l'entrepôt de démonstration](http://localhost:5173/wms?site=cmu209l5t005p94d0dsj9gs70).
2. Réception initiale `RC-000001` validée : 17 EA de DEMO-WMS-KIT et 2.125 KG
   de DEMO-WMS-VRAC dans DEMO-RC. Le journal affiche ces deux entrées et leur dossier.
3. Dans [Rangement](http://localhost:5173/wms/putaway?site=cmu209l5t005p94d0dsj9gs70),
   déplacer 4 EA de DEMO-WMS-KIT de DEMO-RC vers DEMO-A.
4. Ouvrir [PK-000001](http://localhost:5173/wms/picking/cmu209lee007294d0wx8ngfny) :
   le manque initial de 4 EA devient couvert. La finalisation crée la sortie réelle.
5. La réception brouillon `RC-000002` contient 8 EA supplémentaires pour essayer
   la saisie/validation. Les données sont fictives, identifiées DÉMO, sans lien TMS client.

La vérification manuelle locale a ouvert le panneau et sa confirmation puis annulé,
pour conserver le scénario intact et prêt à essayer. Les scénarios complets de
déplacement/prélèvement sont exécutés dans la base HTTP de test séparée.

## Validation

- **112 tests HTTP réussis sur 10 suites** WMS/Cour/configuration. Neuf nouveaux
  cas couvrent le parcours réel réception → MOVE → prélèvement, le snapshot d'unité,
  six envois concurrents d'une même clé, conflits de contenu, rollback, reprise
  après épuisement/désactivation, anciens clients, pagination et droits/module.
- **187 tests UI réussis ensemble (2,6 min, 2 workers)**, dont 11 nouveaux cas :
  file par site, unités séparées, pagination serveur, confirmation annulée,
  conservation du brouillon, perte de réponse puis rechargement/reprise exacte,
  échec de reprise, stockage indisponible, lecture seule, journal contextualisé,
  erreurs distinctes d'un état vide et mise en page téléphone.
- **72 tests unitaires réussis** : 10 API WMS, 21 shared WMS et 41 web; sept nouveaux
  tests du stockage de l'intention (snapshot, restauration, isolation tenant/acteur,
  protection d'une clé plus récente, corruption, quota et absence de session).
- API compilée; Svelte **0 erreur / 12 avertissements préexistants**, dans les cinq
  fichiers hors lot déjà recensés; build SPA de production réussi, adapter-static.
- Vérification manuelle sur données locales et captures à 1280 px / 390 px :
  file, journal et panneau contenus; sélection serveur du vrai site et confirmation
  annulée, aucune consommation du stock de démonstration.
- Démonstration créée par HTTP puis script relancé : seconde exécution sans mutation.

Les premières passes ont corrigé des attentes de tests, pas masqué un comportement :
référence étrangère = 400 (`OwnershipService`), et boutons Fermer distincts dans un
panneau/une fenêtre imbriquée. Les assertions de stock et de reprise sont conservées.
Jest signale toujours les handles asynchrones ouverts après les suites HTTP; dette
préexistante non corrigée. Aucun test de charge, OVH ou effet externe réel revendiqué.

Commandes ciblées (tests HTTP avec la base dédiée et `EMAIL_DRIVER=log`) :

```sh
pnpm --filter @pulsar/api test:e2e --testPathPattern='wms-movement-traceability|wms-guided-operations|wms-workspace|wms-module|wms-fulfillment|yard|module-config'
pnpm --filter @pulsar/api test --runInBand inventory.service.spec.ts receiving.service.spec.ts picking.service.spec.ts
pnpm --filter @pulsar/shared test -- src/wms
pnpm --filter @pulsar/web test
pnpm --filter @pulsar/web test:e2e wms-movement-traceability.spec.ts --workers=2 --reporter=line
pnpm --filter @pulsar/web typecheck
pnpm --filter @pulsar/api build
pnpm --filter @pulsar/web build
```

La passe UI élargie reprend les 19 fichiers du [lot précédent](wms-guided-operations.md)
et ajoute `wms-movement-traceability.spec.ts` (20 fichiers, 187 cas).

## Limites et suite

- Clients historiques sans `operationKey` compatibles, mais sans dédoublonnage durable.
- Reprise liée au navigateur/tenant/acteur; effacement du stockage, changement de
  navigateur et création simultanée de clés distinctes ne sont pas une file offline.
- Ancienne page Inventaire : plafonds historiques 500 soldes, 100 articles et 200 bins
  encore présents; choix recherchables à généraliser. Le déplacement intersites
  historique reste permis en l'absence de `locationId`; le nouveau rangement est même-site.
- Aucun partiel, scan, allocation, réservation, capacité physique, 3D ou provenance par lot.
- Les unités des articles restent modifiables; les nouveaux snapshots préservent
  l'historique, pas une conversion des soldes. Conception d'unités immuables/conversions à suivre.
- Verrou de stock par tenant conservé; pas de validation de charge ou multi-instance UI.
- Prochain module : Flotte, disponibilité des véhicules/remorques et maintenance
  en poste de travail visuel. Puis Fabrication et suggestions d'agents gouvernées,
  sans étendre silencieusement l'autonomie ni les effets externes.
