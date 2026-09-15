# Fabrication — passerelle PlaniAdvance, lot A1

15 septembre 2026 · branche `codex/manufacturing-visual-workspace`.

## Livré dans ce lot

L'interface de Fabrication n'est pas refaite. Le bureau, le shell et les composants
Pulsar sont conservés. Ce lot prépare les données fiables dont le futur poste de
planification a besoin; il ne livre pas encore le Gantt interactif.

- Entrée privée Python `/internal/pulsar/run`, appelée uniquement par l'API Pulsar,
  clé de service obligatoire et contexte tenant issu du JWT Pulsar. Aucune identité
  de démonstration ni lecture dans les repositories persistants de PlaniAdvance.
- Repositories en mémoire **créés par requête**, puis use case existant
  `RunScheduling` : validation, politiques, WIP, solveur et diagnostics. Pas de second
  moteur TypeScript; l'ancien endpoint snapshot reste disponible pour les usages
  autonomes/diagnostics historiques.
- `SchedulingRun.inputRequest` conserve la requête exacte (snapshot, objectif,
  stratégie, horizon explicite, contrat et fuseau). SHA-256 à clés JSON triées dans
  `snapshotHash`; tableaux conservés dans leur ordre. Ce hash couvre la requête,
  pas seulement les affectations. `source_revision` couvre les dossiers de
  fabrication/calendriers/postes lus à la création.
- `engineResult` conserve les affectations et les métriques, diagnostics, résumé,
  analyse et faisabilité. Validation du contrat, du tenant, des références, des
  dates, des doublons et de la couverture complète d'un résultat `feasible` avant
  toute écriture. Erreur moteur ou réponse invalide : aucun run partiel.
- `POST /manufacturing/scheduling/runs/:id/replay`, protégé par le module et
  `manufacturing.manage`, crée une **nouvelle simulation historique** à partir des
  entrées capturées. Le run d'origine reste inchangé. Un replay n'est pas publiable :
  pour engager les opérations, il faut recalculer depuis les données actuelles.
- Publication : `PublishScenario` et `CompareScenarios` du moteur évaluent la
  décision dans un repository éphémère. Aucun effet de publication dans Python.
  Pulsar recontrôle la baseline attendue, la révision des données de fabrication
  et prend un verrou transactionnel par tenant avant le changement effectif.
- Index SQL partiel : **une seule baseline par tenant**. Deux candidats concurrents
  ne s'écrasent pas : un gagne, l'autre reçoit 409. Répéter la publication du run
  encore courant est sans effet; un ancien run remplacé ne peut pas rétablir une
  ancienne baseline. Les outils agents passent toujours par la gouvernance existante.
- Les listes omettent les gros artefacts; le détail les expose aux utilisateurs
  autorisés du tenant. Création et publication restent auditées.

## Contrat et temps

| Élément                              | Valeur A1                             |
| ------------------------------------ | ------------------------------------- |
| Snapshot canonique                   | `aps.canonical.v1`                    |
| Passerelle                           | `pulsar.aps.v1`                       |
| Provenance du moteur                 | projet PlaniAdvance, commit `d26a8cd` |
| Révision d'intégration               | `planiadvance-d26a8cd.pulsar-a1`      |
| Version interne du moteur            | `aps-engine.v1`                       |
| Fuseau supporté par cette passerelle | **UTC uniquement**                    |

La convention historique qui envoyait les composantes UTC au moteur est maintenant
explicite : timestamps Python naïfs **interprétés en UTC**, stockage Prisma en
instants UTC. Le serveur n'utilise plus son fuseau local pour lire les affectations.
La passerelle refuse un autre fuseau : ce n'est **pas** une prise en charge des
horaires d'usine Montréal/Paris ni des shifts traversant les changements DST locaux.
Les tests aux dates DST prouvent l'absence de dépendance au fuseau hôte, pas cette
fonctionnalité industrielle future.

Un replay garantit les **mêmes entrées**, pas un résultat bit-à-bit identique pour
tous les solveurs. Greedy est vérifié sur les mêmes affectations/métriques; les
identifiants, l'horodatage et le temps de calcul changent. Les graines/aléas des
métaheuristiques restent à contractualiser avant une promesse de reproductibilité
de tous les résultats.

## Garde-fous et limites explicites

- Un ordre sans opérations ou une opération sans poste valide n'est plus supprimé
  de la demande. Le calcul refuse et indique le problème à corriger.
- Les statuts d'opération sont transmis. Pulsar n'a pas encore les dates réelles,
  la machine réelle et le restant nécessaires pour replanifier un travail commencé :
  les opérations `IN_PROGRESS`/`COMPLETED` sont refusées à cette frontière, jamais
  assimilées à un travail neuf. Le test Python prouve que le workflow complet sait
  conserver une opération réelle lorsque ces données sont fournies.
- Une décision moteur `review` ou `blocked` ne peut pas être contournée. L'UX de
  revue humaine explicite reste à livrer; aucun `allow_review` accessible ici.
- Runs historiques sans artefacts : consultables, mais ni rejouables ni publiables.
  Une ancienne baseline est comparée sur ses affectations/diagnostics connus,
  sans inventer les métriques manquantes ni corriger rétroactivement ses heures.
- `respectMaterials=true` exige WMS actif; l'option ne peut plus être ignorée.
  Le stock reste une **photographie agrégée du tenant**, pas par usine/entrepôt,
  et ne constitue **aucune réservation**. Le contrôle de révision de publication
  ne porte pas encore sur l'évolution des stocks/nomenclatures. Les unités,
  approvisionnements datés, BOM incomplètes et synchronisation des matières sont
  à durcir dans la suite; ne pas présenter ce lot comme un MRP complet.
- Les lectures de révision constatent les modifications des dossiers avant la
  publication; elles ne gèlent pas les éditions ultérieures des dossiers ni l'atelier.
- Le moteur ne persiste pas les scénarios Pulsar dans sa base autonome. Les routes
  PlaniAdvance Gantt/scénarios persistants ne deviennent pas utilisables avec
  `apsScheduleId` : il faudra continuer la passerelle en mémoire.
- Les quotas de calcul, annulation, budgets mémoire et adresse privée configurable
  pour Docker/OVH restent à faire. Aucun déploiement, push ou PR dans ce lot.

## Migration et runtime

Migration additive : `20260915120000_manufacturing_aps_artifacts`.
Appliquée localement aux bases `pulsar_relaunch_test_20260913` et
`pulsar_relaunch_20260913`, après vérification de l'absence de baselines en doublon.
Elle ne modifie aucune affectation existante, ne backfille pas de snapshot ou de
fuseau supposé, ne touche pas au stock. Si des baselines historiques sont déjà en
doublon, l'index échoue : revue humaine avant migration, pas de gagnant arbitraire.

`APS_API_KEY` de Pulsar est transmis comme `INTEGRATION_API_KEY` au processus Python
managé, sans affichage de la clé. Un moteur externe déjà lancé doit avoir la même
clé configurée. Le bridge fonctionne sans la base autonome du moteur; le healthcheck
`ready` historique continue toutefois de mesurer cette base et peut être rouge.
La distinction de santé « bridge Pulsar / app autonome » reste à exposer.

`pnpm aps:setup` installe désormais les mêmes dépendances verrouillées que la CI,
puis le package local sans nouvelle résolution de dépendances. Les chemins uv et
pip sont couverts; Python 3.12 est le runtime qualifié. Ne pas remplacer le lock
par des versions flottantes sans requalifier le bridge.

## Vérifications

Résultats locaux finaux : **622 tests Python réussis** (7 benchmarks `slow`
hors de cette voie), **261 tests unitaires API réussis**, **11 tests HTTP/DB
réussis avec le vrai moteur**, `pnpm build` et `pnpm typecheck` réussis.
Svelte signale 12 avertissements dans 5 fichiers préexistants, sans erreur;
aucun fichier web n'est modifié. Pas de nouveau test navigateur dans ce lot backend.
La voie GitHub Actions est ajoutée mais **pas encore exécutée sur GitHub**.

- Tests HTTP Python de la nouvelle passerelle avec **vrais solveurs** greedy,
  backward et CP-SAT; deux tenants simultanés avec les mêmes IDs métier, rejeu,
  travail exécuté conservé, authentification et refus de publication.
- Tests TypeScript : empreintes, dates UTC, références/couverture moteur, demande
  conservée, erreurs réseau et timeout couvrant aussi la lecture du corps HTTP.
- Suite HTTP PostgreSQL `manufacturing-aps-bridge.e2e-spec.ts` : persistance,
  droits et modules, isolation, rejeu, erreurs sans écritures partielles, conflits
  de publication et données devenues périmées. Passe avec stub déterministe, puis
  avec le vrai moteur sur un port de test dédié (`PULSAR_TEST_REAL_APS=true`).
- Nouvelle voie CI `aps-engine` : Python 3.12, OR-Tools et dépendances transitives
  verrouillées avec hashes dans `services/aps/requirements-ci.lock`. Exécute les
  tests `domain`, `scheduling`, `integration` et `api/test_pulsar_bridge.py` avec une
  adresse DB volontairement indisponible. Aucun skip conditionné à l'installation.
- La totalité des tests de l'application autonome Python n'est **pas** déclarée
  verte : la tentative de suite globale rencontre une dépendance DB non simulée
  dans `test_accounts_http`. La voie CI ci-dessus qualifie le périmètre moteur et
  passerelle; elle ne masque pas ce reste à isoler.

## Prochain incrément : A2 avant le Gantt interactif

1. Fuseau par site et conversion heure d'usine ↔ instant, tests Montréal/autre
   fuseau, horaires inexistants/ambigus et shifts traversant DST.
2. Baseline comme entrée de calcul, aperçu/actions, comparaison structurée et
   revue humaine explicite réutilisant les use cases du moteur.
3. Données d'exécution réelles/restant/gel et profil de capacités par stratégie;
   parité avancée, pas de champs UI sans enforcement moteur.
4. Qualification fraîcheur matières, unités et site, budgets de calcul et tests de
   charge; distinction runtime bridge/autonome dans l'admin.
5. Puis lot B visuel, **avec les primitives et le style de Pulsar**, sans thème React
   PlaniAdvance et sans changement du bureau d'apps.
