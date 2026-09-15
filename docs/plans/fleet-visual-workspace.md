# Flotte — poste de travail visuel

Lot du 14 septembre 2026, branche `codex/fleet-visual-workspace`.

## Livré

Le bureau d’apps et le shell Pulsar sont conservés. La refonte suit le skill
`redesign-existing-projects` : composants existants, panneaux animés, hiérarchie
orientée travail et informations métier explicites, sans dépendance ajoutée.

- `/fleet` : parc interne ou complet, véhicules/remorques, recherche unité/plaque,
  états, pagination et compteurs serveur. Les compteurs globaux ignorent la recherche
  et le filtre d’état, mais respectent le type et le périmètre interne/externe.
- Échéancier UTC sur sept jours : nombre exact d’interventions actives par date,
  files de la semaine, avant la semaine, sans échéance et historique terminé/annulé.
  Les nombres ne sont pas extrapolés depuis la page de résultats.
- Fiche latérale d’actif : interventions, échéances des documents et, si autorisé,
  chargements TMS non terminés. Une expiration n’est pas une certification de conformité.
- Dossier d’intervention : création, modification des consignes/prestataire/date,
  démarrage, annulation et clôture avec coût/devise/kilométrage optionnels.
  Les confirmations expliquent les effets; aucune facture ou paiement n’est créé.
- `/fleet/register` conserve l’ancien registre, les plans préventifs et les fiches
  complètes. `/fleet/maintenance` reste disponible pour les utilisateurs ayant les
  droits TMS nécessaires à cet écran historique. Pas de suppression du CRUD existant.

## Contrats et sécurité

| Route                                                        | Contrat                                                                      |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `GET /fleet/workspace`                                       | `fleet.read`, module Fleet; filtres kind/ownership/status/search, pagination |
| `GET /fleet/workspace/orders`                                | mêmes filtres, `from=YYYY-MM-DD`, bucket dated/overdue/undated/history       |
| `GET /fleet/workspace/assets/:kind/:id`                      | actif du tenant, projections de contexte                                     |
| `GET /fleet/workspace/order-fields`                          | `fleet.manage`; champs personnalisés du bon module/entité                    |
| `PATCH /fleet/maintenance-orders/:id`                        | `fleet.manage`; consignes, prestataire, date nullable et version optionnelle |
| `POST /fleet/maintenance-orders/:id/{start,complete,cancel}` | workflow existant, accepte aussi `expectedUpdatedAt`                         |

Toutes les lectures sont scopées par le tenant du JWT. Les références d’actif passent
par `OwnershipService`. Le contexte des chargements exige à la fois le module
Transportation et `transportation.planning.read`; aucun appel TMS n’est requis pour
la lecture du poste Flotte seul. Les liens des registres historiques exigent aussi
le module Transportation et `transportation.master-data.read`.

Les mutations de maintenance sont sérialisées par un verrou PostgreSQL sur le tenant.
L’ordre, la synchronisation de l’actif et le réancrage du plan sont dans la même
transaction. Les transitions utilisent les state machines existantes et des claims
conditionnels. Fermer une intervention ne libère l’actif que s’il est encore en
MAINTENANCE et qu’aucun autre ordre OPEN/IN_PROGRESS ne le vise. RETIRED n’est jamais
réactivé et un état externe différent n’est pas écrasé lors de la clôture.

La génération depuis un plan vérifie son activation et son actif, puis réutilise
l’ordre actif existant sous le même verrou. Deux générations simultanées ne créent
pas deux ordres actifs. L’ouverture manuelle de plusieurs travaux reste possible.

Les nouvelles saisies UI transmettent `expectedUpdatedAt`; une version périmée
retourne 409 et conserve la saisie. La version avance aussi pour deux changements
très rapprochés. Les clients historiques sans version restent compatibles. Les
consignes vides/nulles, coûts négatifs ou à plus de deux décimales et kilométrages
négatifs sont refusés. Les custom fields restent validés par le service générique.

Audit et événement métier sont émis **après le commit**, via les services best-effort
existants; rien n’est émis pour une transaction échouée. Ceci évite le verrou de FK
du tenant pendant l’audit. Ce n’est pas un outbox transactionnel : un arrêt du
processus entre commit et émission reste une limite connue.

## UX et sens des données

Une échéance est une **date limite UTC**, pas un créneau de garage. Ouvrir un ordre
met immédiatement l’actif en maintenance, même si sa date est future. Les plans
préventifs restent la voie pour prévoir un cycle sans ouvrir immédiatement un ordre.
Le statut AVAILABLE n’est ni une réservation ni une promesse de disponibilité TMS.

Le panneau bloque les doubles clics et la fermeture pendant l’enregistrement.
Fermer une saisie ou actualiser un formulaire en cours demande confirmation. Un
échec connu conserve les champs; un résultat réseau incertain désactive les mutations
et demande une inspection avant une nouvelle action. **Pas de reprise durable ni
de clé d’idempotence sur la création manuelle**, contrairement au MOVE WMS.

La fiche d’actif affiche au plus 30 interventions et 30 documents, avec total et
avertissement explicites; le contexte TMS affiche au plus 10 chargements. Le parc et
l’échéancier sont paginés, mais les anciens registres conservent leurs plafonds
historiques (notamment 100 ordres, 200 plans et listes de référentiels).

## Essayer en local

API sur 3100 et SPA sur 5173; aucune migration requise. `.env` conservé, pas de
déploiement OVH, de push, d’email réel ou de changement de gouvernance agent.

Ouvrir [le poste Flotte](http://localhost:5173/fleet), tenant `acme` :

1. `DEMO-FLT-101` a deux interventions actives, une échue et une à venir, ainsi
   qu’un document fictif expiré. Terminer un seul ordre doit laisser la maintenance.
2. `DEMO-FLT-102` est disponible, sans travaux ouverts.
3. Passer aux remorques pour `DEMO-FLT-R01`, avec une inspection sans date.
4. Consulter le plan `[DÉMO] Entretien tous les 90 jours` dans le registre conservé.

Scénario créé exclusivement par les services HTTP métier. La vérification manuelle
a ouvert les fiches et l’éditeur puis abandonné la saisie sans exécuter de transition.
Les parcours complets sont exécutés dans la base de test distincte.

```sh
node scripts/seed-fleet-demo.mjs --create
```

Le script est limité à localhost, refuse les redirections et ne réinitialise aucune
donnée existante. Une seconde exécution s’arrête sans mutation. Le paramètre technique
`--resume-empty` ne reprend que le premier véhicule fictif encore vide et disponible.
Lors de cette livraison, deux erreurs de payload du script ont été corrigées
(`STRAIGHT_TRUCK`, absence d’anchorDate dans le DTO de création du plan); le scénario
partiellement créé a été complété sans supprimer ni réinitialiser d’actif.

## Validation

- 53 tests HTTP réussis, trois suites : Fleet workspace, Fleet historique et
  configuration WMS/Yard/Fleet. Dix nouveaux scénarios couvrent les droits, le
  module désactivé, les autres tenants, la pagination exacte, les dates UTC,
  les conflits de version et les fermetures/générations concurrentes.
- 108 tests UI réussis ensemble, puis 11 tests Fleet ciblés après correction des
  champs numériques facultatifs effacés (109 parcours distincts) : filtres,
  panneaux, contexte TMS, confirmations, conservation des champs, panne réseau,
  champs personnalisés indisponibles, lecture seule et téléphone 390 px.
- 87 tests unitaires réussis : 12 API Fleet, 31 shared Fleet, 44 web.
- Compilations shared/API et SPA réussies. Svelte : zéro erreur, 12 avertissements
  préexistants dans cinq fichiers hors lot.
- Inspection visuelle des captures 1280 px et 390 px, puis parcours manuel sur
  les données locales. Pas de test de charge, d’atelier réel ni de déploiement cloud.

```sh
pnpm --filter @pulsar/api test:e2e --runTestsByPath test/fleet-workspace.e2e-spec.ts test/fleet-module.e2e-spec.ts test/configurable-wms-yard-fleet.e2e-spec.ts
pnpm --filter @pulsar/api test --runInBand --testPathPattern=fleet
pnpm --filter @pulsar/shared test fleet
pnpm --filter @pulsar/web test
pnpm --filter @pulsar/web test:e2e e2e/fleet-workspace.spec.ts e2e/screen-surfaces.spec.ts e2e/screen-redesign.spec.ts e2e/record-screens.spec.ts e2e/wms-workspace.spec.ts e2e/wms-guided-operations.spec.ts e2e/wms-movement-traceability.spec.ts --workers=2
```

Tests HTTP à lancer uniquement contre une base migrée/seedée dédiée, EMAIL_DRIVER=log.

## Prochaines étapes

1. **Fabrication visuelle** : postes, ordres, encours, blocages et flux entre étapes,
   à partir des workflows existants; conserver le bureau et les mêmes panneaux.
2. Flotte v2 : paginer les anciens registres et les documents d’actifs, intégrer les
   inspections/relevés aux files de travail, prévoir la création manuelle idempotente.
3. Concevoir séparément de vrais créneaux atelier/technicien et une disponibilité
   prévisionnelle reliée au dispatch. Ne pas déduire ces promesses d’une simple date.
4. Suggestions d’agents gouvernées, avec motif et résultat reliés au dossier; pas
   d’envoi externe ni d’augmentation d’autonomie implicite.

Le verrou partagé par tenant et les requêtes de comptage sont adaptés au lot local,
pas validés à grande échelle. Mesurer avant de modifier la granularité du verrou,
ajouter des index date/remorque ou introduire des agrégations de lecture.
