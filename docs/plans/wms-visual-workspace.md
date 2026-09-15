# WMS — poste de travail visuel, v1

Date : 2026-09-14. Branche : `codex/wms-visual-workspace`.
Base : `816c9ea`, Cour ↔ TMS ↔ WMS connectés.

## Intention et résultat

Approfondir les modules avec des interfaces de travail adaptées au métier, sans
remplacer le bureau d'applications ni les composants partagés. Le skill
`redesign-existing-projects` a guidé l'audit de l'accueil existant : les totaux
multi-sites et la somme de quantités d'unités différentes ont été remplacés par
une lecture par entrepôt, des files actionnables et des panneaux contextuels.

`/wms` expose maintenant :

- un sélecteur d'entrepôt recherchable, un rafraîchissement explicite et son heure;
- quatre files : réceptions DRAFT, emplacements RECEIVING avec du stock,
  préparations OPEN et préparations PICKED à finaliser;
- un schéma de zones regroupant les emplacements par type et nom de zone;
- une recherche serveur et une pagination des emplacements;
- un panneau de stock par article, avec sa quantité décimale et son unité;
- la modification de la zone d'affichage et un MOVE confirmé vers un emplacement
  actif du même site, pour les utilisateurs autorisés;
- des liens vers les listes/fiches métier et la Cour du site si autorisée;
  les fiches réception/préparation permettent le retour au même entrepôt.

Le rangement est une lecture des emplacements de réception non vides, pas un
suivi de lots provenant de chaque réception. Les quatre files sont indépendantes.
Valider un déplacement n'achève ni réception, ni préparation, ni transport.

## Contrats et données

Migration additive `20260914230000_wms_bin_zones` : `Bin.zone TEXT NULL` seulement.
Pas de coordonnées physiques, capacité, nouveau statut ou rollup persisté.
Zone normalisée par trim, 80 caractères maximum, vide ⇒ null. Le regroupement pur
`groupWmsBins` vit dans `@pulsar/shared` et conserve les types réception/stockage/
expédition distincts, même avec un nom de zone identique.

| Endpoint                                     | Contrat                                                                                   |
| -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `GET /wms/sites`                             | Entrepôts du tenant, recherche code/nom, pagination ≤100                                  |
| `GET /wms/sites/:id`                         | Projection entrepôt; site étranger ou non-WAREHOUSE ⇒404                                  |
| `GET /wms/workspace?locationId=…&q=…&page=…` | Snapshot cohérent RepeatableRead; 80 emplacements/page; compteurs sur tout le site        |
| `GET /wms/workspace/bins/:id?q=…&page=…`     | Stock par SKU/nom, 50 lignes/page, quantités sous forme décimale textuelle                |
| `PATCH /wms/bins/:id`                        | Zone via endpoint existant; `expectedUpdatedAt` optionnel, conflit ⇒409                   |
| `POST /wms/inventory/move`                   | Endpoint existant; l'UI ajoute `locationId` pour vérifier source/destination du même site |

Les nouvelles lectures demandent module WMS + `wms.read`. Les mutations restent
`wms.manage`, tenant pris du JWT. La lecture des entrepôts ne demande plus les
droits TMS dans les écrans WMS modifiés. Créer un site reste une responsabilité
d'administration des localisations, pas une nouvelle fonction du workspace.

Les files de documents affichent les 20 plus anciens et le total réel; le
rangement affiche 20 emplacements avec stock et signale sa limite. La recherche
des destinations utilise `/wms/bins` existant, plafonné à 200. Les compteurs du
site ne sont pas réduits par la recherche/pagination du schéma. Aucune quantité
globale mélangeant articles ou unités, aucun pourcentage de capacité inventé.

## Intégrité du stock et configuration

Le panneau réutilise `InventoryService`, pas un nouveau chemin de mutation :

- ownership de l'article, source, destination et site optionnel vérifié;
- le writer commun revalide article/bins dans la transaction;
- emplacements inactifs refusés pour les mouvements ordinaires; l'ajustement
  explicite reste possible pour corriger l'historique, sans produire un solde négatif;
- quantité positive finie, au plus trois décimales; source distincte de destination;
- disponibilité vérifiée; solde et `StockMovement` écrits dans la même transaction;
- verrou PostgreSQL de la ligne tenant partagé par tous les appels à
  `postMovement` et les changements de configuration de bin : protège aussi les
  soldes absents et les opérations multi-lignes contre les mises à jour perdues;
- `adjust` utilise désormais ce même writer; les écarts de comptage sont calculés
  en Decimal pour ne pas rejeter les différences décimales à cause de JavaScript;
- site d'un bin immuable; désactivation ou changement de type refusé si un solde
  non nul existe. Zone seule modifiable avec du stock. Audit existant conservé.

Le verrou est volontairement grossier, **par tenant**, pas par article/bin.
Mesurer la contention avant de viser de gros volumes; pas de qualification de
charge dans ce lot. Les anciens clients omettant `locationId` sur MOVE conservent
leur comportement inter-sites; ce n'est pas une nouvelle fonction de transfert
guidé entre entrepôts.

## Comportement UX et erreurs

Panneau animé commun, fermeture protégée pendant l'écriture, confirmation avant
MOVE. Le formulaire remplace temporairement la liste de stock pour rester visible
sur les emplacements chargés. Annuler la confirmation n'écrit rien. Les erreurs
de validation/conflit conservent la quantité, la destination et la zone saisies.

Après réponse réseau incertaine ou 5xx sur MOVE, pas de renvoi automatique ni de
bouton de retry : fermeture et actualisation demandées. **Il n'y a pas de clé
d'idempotence durable sur MOVE** : un résultat perdu peut avoir été appliqué.
La fermeture ne prouve pas l'échec; vérifier le stock et le journal avant un nouvel
essai. Les anciennes surfaces de mouvement ne sont pas toutes refondues ici.

Les requêtes tardives de recherche sont ignorées. Un panneau d'un autre site est
refusé côté UI; le serveur vérifie toujours le tenant. Les erreurs de chargement
ne deviennent pas un faux état « tout est vide ». Stock négatif historique et
emplacements inactifs sont signalés, pas corrigés silencieusement.

## Validation

- Migration appliquée sur les bases locales de développement et de test;
  Prisma généré, packages database/shared reconstruits.
- 74 tests HTTP réussis sur 5 suites, dont 13 nouveaux : WMS seul, isolation,
  permissions, versions concurrentes, limites/pagination, stock mixte par unité,
  retrait concurrent, création concurrente de solde et comptage fractionnaire.
- 10 tests unitaires API WMS, 21 shared WMS et 34 web.
- **163 tests UI réussis ensemble (2,1 min, 2 workers)** : 14 nouveaux scénarios WMS
  et régression Cour, CRM, Finance, fiches, navigation, tablette et mobile.
  Quantité/destination conservées sur conflit, réponse réseau incertaine,
  fermeture pendant écriture, zone versionnée, navigation de dossier, pagination,
  lecture seule et lien profond d'un autre site couverts.
- **Svelte : 0 erreur, 12 avertissements préexistants** hors de ce lot.
  Builds API et SPA de production réussis. Captures du schéma desktop, du stock et
  du déplacement à 390 px inspectées, sans débordement horizontal.
- La première passe UI a détecté une valeur initiale `undefined` incompatible avec
  le champ lié Svelte : corrigée en `null`. Le formulaire de mouvement a ensuite
  été validé, y compris les échecs. Les sélecteurs de liens ont été alignés sur
  leurs noms accessibles complets, sans suppression des assertions métier.

Les tests navigateur utilisent une connexion locale réelle et des réponses/
mutations WMS contrôlées; les tests HTTP exécutent les vraies mutations dans la
base de test dédiée. Aucun stock ni dossier fictif ajouté à la base de
développement pour remplir l'écran. Jest signale encore des handles asynchrones
ouverts après les suites HTTP. Ce lot ne qualifie ni OVH ni les fournisseurs tiers.

Commandes de validation (HTTP avec `DATABASE_URL` vers la base de test dédiée et
`EMAIL_DRIVER=log`; UI avec API locale 3100 et Vite 5173) :

```sh
pnpm --filter @pulsar/api test:e2e --testPathPattern='wms-workspace|yard-dossiers|configurable-wms-yard-fleet|wms-module|wms-fulfillment'
pnpm --filter @pulsar/api test --runInBand inventory.service.spec.ts receiving.service.spec.ts picking.service.spec.ts
pnpm --filter @pulsar/shared test -- src/wms
pnpm --filter @pulsar/web test
pnpm --filter @pulsar/web typecheck
pnpm --filter @pulsar/api build
pnpm --filter @pulsar/web build
pnpm --filter @pulsar/web test:e2e wms-workspace.spec.ts yard-dossiers.spec.ts yard-workspace.spec.ts bank-csv-import.spec.ts finance-connected-flow.spec.ts finance-audit.spec.ts billing-screens.spec.ts record-screens.spec.ts fulfillment.spec.ts screen-redesign.spec.ts screen-surfaces.spec.ts workspace.spec.ts crm-pipelines.spec.ts crm-sequences.spec.ts journeys.spec.ts responsive.spec.ts loads-list.spec.ts control-center.spec.ts --workers=2 --reporter=line
```

Vérification en lecture seule du serveur relancé : `/wms/sites` répond 200; le
tenant démo Acme n'a actuellement aucun entrepôt WAREHOUSE configuré. Son accueil
présente donc l'état initial, pas les fixtures des tests. Configurer un site et
ses emplacements avant une démonstration métier avec de vraies données.

## Suite conseillée

1. **Préparation et réception guidées** : travailler par lignes, voir demandé/
   disponible/prélevé avec unités, bloquants explicites, scanners et raccourcis;
   vérifier les références site/article/bin et les éditions concurrentes des
   anciennes fiches avant d'élargir leurs actions.
2. **Rangement traçable et mouvements robustes** : idempotence durable du MOVE,
   journal contextualisé, pagination des référentiels historiques, puis allocations/
   réservations avec un vrai contrat de stock. Ne pas appeler « disponible » le
   stock physique sans déduire les engagements.
3. **Parcours Cour ↔ réception/préparation ↔ transport** : cohérence guidée des
   lignes/expéditions liées, sans transformer une association en preuve de livraison.
4. **Flotte puis Fabrication** : disponibilité/maintenance et postes/flux, en
   appliquant le même principe d'UI spécialisée plutôt qu'un tableau générique.
5. **Agents contextuels** : outils READ métier puis propositions via registre et
   `ProposedAction`. Aucun nouvel outil ni contournement de gouvernance dans ce lot.

Limites explicites : schéma non physique, pas de plan 3D, capacité, lots/séries,
réservation, mode hors ligne, temps réel ou putaway automatique. Les fiches CRUD
historiques ne sont pas toutes refondues; plusieurs listes gardent leurs plafonds
existants et l'accès au comptage/inventaire global n'est pas partout filtré au site.
Pas de promesse d'adaptation universelle à tous les métiers.

Aucun push GitHub, déploiement OVH ou changement de `.env` dans ce lot.
