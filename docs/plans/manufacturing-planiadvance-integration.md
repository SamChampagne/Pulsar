# Fabrication : intégrer la richesse de PlaniAdvance

Audit du 15 septembre 2026. Branche de travail : `codex/manufacturing-visual-workspace`,
créée depuis `origin/main` (`5c985e7`, fusion de #79).

## Décision de reprise

La priorité n'est plus une simple refonte de l'accueil Fabrication. L'utilisateur
demande de prendre en compte son projet PlaniAdvance, déjà conséquent. Il faut
exposer ses capacités dans Pulsar, préserver ses règles de planification et éviter
une seconde application indépendante. Ce document est un audit et une proposition
d'intégration par lots, pas une déclaration de fonctionnalités livrées.

Le bureau d'apps Pulsar reste inchangé. Les registres existants restent accessibles.
L'interface React de PlaniAdvance sert de référence fonctionnelle, pas de deuxième
shell à embarquer. Le moteur Python reste la source des calculs et des diagnostics.

### Contrainte UI confirmée par l'utilisateur (15 septembre 2026)

Fabrication doit rester visuellement et ergonomiquement une app Pulsar. Intégrer
les capacités de PlaniAdvance ne signifie pas reprendre son thème ou son interface.

- Conserver le bureau, le shell, la navigation et le changement d'app Pulsar.
- Réutiliser les tokens existants : typographie, couleurs, espacements, rayons,
  densité et états interactifs. Aucun thème propre à Fabrication.
- Réutiliser les boutons, champs, filtres, panneaux animés, confirmations,
  notifications et comportements clavier/mobile des autres modules.
- Spécialiser uniquement le contenu métier : Gantt, lignes de postes, dépendances,
  scénarios et diagnostics. Les nouveaux composants métier utilisent les mêmes
  tokens et primitives; pas de deuxième barre de navigation ou de shell React.
- Vérifier chaque livraison dans le shell réel, à côté des modules Cour, WMS et
  Flotte : cohérence des contrôles, focus, transitions, densité et responsive.

Critère d'acceptation : changer d'app vers Fabrication ne doit pas donner
l'impression de changer de logiciel. Le moteur est PlaniAdvance; l'expérience
utilisateur reste Pulsar.

## Sources effectivement inspectées

- Projet original : `C:/Users/samol/Projet/PlaniAdvanceV2/planiadvance_v2`,
  dépôt parent `PlaniAdvanceV2`, HEAD `d26a8cd`, branche
  `claude/analyse-avancement-projet` (27 commits locaux en avance sur son upstream).
- Le projet original a des modifications locales dans `ui/src/design/tokens.css`
  et `ui/src/lib/studio/blockMeta.ts`. Elles ont été laissées intactes. Aucun fetch,
  checkout, commit, copie ou écriture n'a été effectué dans ce projet.
- Comparaison des 268 fichiers Python applicatifs avec `services/aps/planiadvance_v2` :
  253 identiques octet pour octet; les autres ne diffèrent que par les fins de ligne.
  Le fichier `infrastructure/pdf/__init__.py` est vide dans les deux projets.
  Il ne faut donc pas réimporter le moteur à l'aveugle.
- Documentation PlaniAdvance : `docs/engine-gantt-interaction.md`,
  `engine-scenario-management.md`, `engine-wip-firm-frozen-zones.md`,
  `engine-material-pegging.md`, `V1.2-ROADMAP.md`; confrontée aux use cases actuels.
  Les pourcentages de maturité historiques ne sont pas des mesures de cette revue.
- UI source : Scheduling, Scenarios, composants Gantt et conversion `wallClock.ts`;
  capture historique `docs/gantt-after-fixes-v3.png` inspectée, pas un test UI live.
- Pulsar : modèles Prisma Manufacturing, `core/aps`, snapshot builder, service de
  scheduling, outils agents et écrans Fabrication.

## Ce qui existe et ce que Pulsar expose

| Capacité                                                                      | Dans PlaniAdvance / moteur copié                                                | Dans le parcours Pulsar actuel                                                                 |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Ordonnancement multi-stratégies                                               | Registre et profils de capacités; greedy, backward, CP-SAT et autres stratégies | Calcul branché; choix UI statique, pas un pilotage complet par les profils                     |
| Postes, calendriers, gammes, nomenclatures, ordres                            | Modèles industriels et canonical snapshot extensible                            | CRUD natif, version simplifiée du contrat                                                      |
| Ressources secondaires, réglages par famille, calendriers exceptionnels, lots | Champs et logique de calcul présents                                            | Pas transmis par le snapshot builder actuel                                                    |
| Travail en cours, temps réel, zones fermes/gelées                             | `planning_policy`, `wip_remaining_split`, dispositions et overrides             | Pas de champs réels/fences dans le modèle Pulsar; statuts d'opération non transmis au moteur   |
| Gantt interactif                                                              | Lignes machines/ordres, dépendances, créneaux admissibles, aperçu puis candidat | Projection simple des affectations; pas de preview/apply moteur                                |
| Scénarios                                                                     | Comparaison, deltas KPI, stabilité, décision publishable/review/blocked         | Historique de runs et booléen `isBaseline`                                                     |
| Diagnostics                                                                   | Faisabilité, exceptions, chemin critique, capacité, résumé, matières            | Diagnostics JSON persistés; plusieurs résultats structurés non conservés/exposés               |
| Matières                                                                      | Inventaire, approvisionnements datés, traçabilité des besoins dans le plan      | Option API `respectMaterials`, BOM × quantité et stock WMS agrégé; absente du formulaire Gantt |
| Promesse de date / perturbations                                              | Use cases CTP, simulation et réparation                                         | Pas exposés par la passerelle Pulsar                                                           |
| Connecteurs et Studio                                                         | Mapping, flux, Odoo, imports/exports, journaux                                  | Socle de connexions Pulsar distinct; pas de parcours unifié PlaniAdvance                       |
| Agents                                                                        | La logique de décision est dans le moteur                                       | Outils Pulsar de lecture/calcul/publication présents; publication gouvernée                    |

Ces capacités ne sont pas toutes supportées uniformément par chaque stratégie.
Les profils du moteur doivent guider les choix; une case UI ne prouve pas qu'une
contrainte est appliquée par le solveur sélectionné.

## Écarts prioritaires constatés dans le code

### 1. Le calcul ponctuel n'est pas le workflow complet de PlaniAdvance

[`ApsClient.runFromSnapshot`](../../apps/api/src/core/aps/aps.client.ts) appelle
`/integration/scheduling/run-from-snapshot`.
[`RunSchedulingFromSnapshot`](../../services/aps/planiadvance_v2/application/use_cases/run_scheduling_from_snapshot.py)
construit un contexte, résout et renvoie le résultat, sans enregistrer un planning
dans le repository des scénarios du moteur. La route journalise l'appel, pas le
planning complet. L'identifiant `apsScheduleId` enregistré dans Pulsar ne suffit
donc pas à appeler les endpoints PlaniAdvance de scénario/Gantt persistant.

Le use case complet [`RunScheduling`](../../services/aps/planiadvance_v2/application/use_cases/run_scheduling.py)
traite notamment baseline, actions planificateur, WIP, politique de gel et replay.
Une extension doit réutiliser ces mécanismes, pas les réécrire en TypeScript.

### 2. La frontière perd du contexte important

[`snapshot-builder.ts`](../../apps/api/src/modules/manufacturing/scheduling/snapshot-builder.ts)
omet notamment les statuts d'exécution, ressources secondaires, setup matrices,
approvisionnements datés, alternatives de gamme et fences. Le modèle Prisma n'a
pas encore toutes ces données. Ne pas les inventer ni présenter un ordre
IN_PROGRESS comme une preuve d'avancement mesuré des opérations.

[`SchedulingService.run`](../../apps/api/src/modules/manufacturing/scheduling/scheduling.service.ts)
conserve affectations et diagnostics, mais pas le snapshot complet, les métriques,
l'analyse et le résumé structurés. `snapshotHash` lit une métadonnée que le builder
ne renseigne pas. L'horizon renvoyé est facultatif et la route snapshot actuelle ne
le renseigne pas explicitement. Le replay fiable n'est donc pas acquis.

### 3. Publication plus faible que dans le projet source

`SchedulingService.publish` remplace le booléen baseline après vérification du
tenant. Il n'appelle pas le contrôle métier de
[`PublishScenario`](../../services/aps/planiadvance_v2/application/use_cases/publish_scenario.py)
et ne reprend pas ses refus de scénario infaisable/bloqué ni sa revue explicite.
La baseline attendue et la concurrence de deux publications doivent être protégées.
L'approbation d'un agent ne doit pas contourner ces contrôles métier.

### 4. Temps d'usine à rendre explicite

Le builder retire le fuseau avec `toISOString().slice(0, 19)`, tandis que les
affectations sont relues avec `new Date(a.start)` sur des dates potentiellement
naïves. Le résultat peut dépendre du fuseau du serveur. PlaniAdvance a déjà une
convention d'heure d'usine et des conversions dédiées dans son UI.
Définir le fuseau du site, le stockage des instants et le contrat moteur avant
d'autoriser les déplacements horaires; tester Montréal, UTC, un autre fuseau et DST.

### 5. Lien WMS encore limité

`loadMaterials` agrège le stock du tenant par SKU, sans périmètre entrepôt/site,
et traite l'absence de WMS par un avertissement. Les nomenclatures utilisent des
références libres et des quantités flottantes. Il manque les contrats explicites
d'unité, d'approvisionnement et de disponibilité pour un site de production.
Une réservation simulée dans le solveur ne constitue jamais une réservation ni
un mouvement réel WMS. Aucun stock ne doit changer en publiant un planning.

### 6. CI verte ne signifie pas APS industriel validé

La CI de `main` après #79 est verte :
[run 34922737044](https://github.com/SamChampagne/Pulsar/actions/runs/34922737044).
Mais la CI Pulsar ne provisionne pas le moteur Python et ses tests HTTP APS sont
conditionnels à l'installation. Il faut une voie APS explicite, avec Python,
OR-Tools, contrats et tests d'isolation. Ne pas compter les suites sautées comme
une preuve d'intégration.

### 7. Déploiement du moteur à traiter

Le client est actuellement fixé sur `127.0.0.1:APS_PORT`. Le runtime est un enfant
Python local. Un conteneur APS séparé sur OVH exige un adressage privé configurable,
une authentification de service, des limites de calcul et un healthcheck; pas
l'exposition publique des routes autonomes PlaniAdvance. Aucun accès VPS requis
pour l'audit; aucune modification du serveur n'a été faite.

## Architecture recommandée

```text
Bureau Pulsar → Fabrication (Svelte)
                    ↓ API tenant-scopée / permissions / audit
              PlanningService Pulsar
                    ↓ contrat versionné : snapshot + baseline + intention
              Adaptateur Python interne
                    ↓ ports en mémoire propres à la requête
              Use cases et solveurs PlaniAdvance existants
                    ↓ candidat + diagnostics + décision de publication
              Persistance et gouvernance Pulsar
```

Pulsar possède les dossiers, les versions, les scénarios persistés, les connexions
et les approbations. Le moteur possède la faisabilité et les calculs. Étendre la
frontière interne pour alimenter les use cases complets avec des repositories en
mémoire par requête est la piste privilégiée; sa parité doit être prouvée avant
exposition UI. Ne pas implémenter un second moteur de règles pour contourner les
limitations de l'appel snapshot actuel.

Les références baseline/candidat sont relues côté Pulsar avec le tenant du JWT;
aucun identifiant moteur fourni par le navigateur n'ouvre une lecture globale.
La requête de calcul porte un contexte de corrélation/scoping authentifié pour les
journaux; aucune identité de démonstration implicite en SaaS. Aucun envoi direct
du navigateur vers Python. Aucune seconde authentification utilisateur.

## Lots proposés, dans l'ordre

### A. Contrat APS complet et fiabilité

- Provenance du moteur (commit source, contrat, version), tests Python reproductibles.
- Tests de parité entre l'adaptateur snapshot et le parcours complet : contraintes,
  WIP, gel, scénarios et diagnostics. Repositories en mémoire isolés par requête.
- Snapshot immuable, hash déterministe, paramètres/horizon/fuseau/version moteur,
  métriques et diagnostics structurés enregistrés dans Pulsar.
- Validation des références, des réponses moteur et des opérations non planifiées;
  pas de disparition silencieuse de demande.
- Gate de publication métier, baseline attendue, transaction et idempotence.
- Tests deux tenants simultanés, deux publications concurrentes, runtime absent,
  calcul en échec, réponse invalide et fuseaux/DST. Un échec conserve la baseline.

**Sortie :** un calcul est explicable et reproductible, une publication est gardée,
les tests APS tournent réellement dans CI. Aucun Gantt interactif avant cette base.

### B. Poste de planification visuel

- Accueil travail : ordres à préparer, postes, exceptions et dernière baseline.
- Gantt par poste ou ordre, réglage/run séparés, dépendances, échéances, recherche,
  zoom adapté, vues sauvegardées et panneau de dossier.
- Indications de données périmées/incomplètes, motif de chaque blocage; compteurs
  exacts, pagination/virtualisation selon volume et états vide/erreur/chargement.
- Comparaison lisible baseline/candidat et KPI avec leur périmètre explicite.
- Capacités et stratégies proposées selon le moteur, pas une liste UI indépendante.

**Sortie :** le planificateur comprend le plan et trouve un blocage sans ouvrir
plusieurs registres. Réutiliser les composants Pulsar, pas copier les barres de
navigation imbriquées de l'ancienne application.

### C. Décisions interactives et simulations

- Créneaux faisables, déplacement guidé, freeze/unfreeze, priorité et perturbation.
- Intention → aperçu moteur → candidat enregistré → comparaison → publication.
- Aucun PATCH direct d'affectation; confirmations, versions, conflits et reprise
  d'une réponse incertaine. Undo/redo porte sur les intentions/scénarios, pas sur
  des mutations silencieuses du plan publié.
- Scénarios nommés, refus expliqués, stabilité et effet sur les autres ordres.
- Consultation mobile et commandes clavier; drag facultatif, jamais seul moyen d'agir.

### D. Données industrielles et exécution

- Ressources secondaires, calendriers exceptionnels, maintenance de postes,
  réglages par famille, alternatives, dépendances avancées et règles de lots.
- Statut réel d'opération, réalisé/restant, dates réelles et zones fermes/gelées.
- Écrans simples par défaut, options avancées activables selon l'entreprise.
- Schéma/DTO/machines d'état/ownership/audit/tests avant exposition des nouveaux champs.
- Éviter la confusion entre poste de fabrication et véhicule Fleet; concevoir les
  connexions de maintenance au lieu de réutiliser une FK d'actif non compatible.

### E. Connexions métier et agents

- Hub de connexions Pulsar unique; adaptateurs et mappings Odoo/ERP issus de
  PlaniAdvance, credentials chiffrés, diagnostic, simulation et journal communs.
- WMS : matières par site/unité, approvisionnements datés, besoins et manques;
  production/réception réelle séparée du plan et via les writers WMS existants.
- CRM/ventes : demande reliée à l'ordre, estimation CTP présentée comme simulation;
  date promise seulement après décision métier explicite.
- TMS/Cour : liens aux flux de sortie sans inventer des réservations de quai ou
  changer les statuts de transport lors d'un calcul.
- Agents : expliquer, comparer et proposer via le registre; publication et effets
  externes gouvernés. Caps, idempotence et audit inchangés.

### F. Déploiement APS OVH et qualification

- Service Python privé, adresse configurable, clé de service, healthchecks,
  budgets temps/mémoire/concurrence par tenant, arrêt et reprise maîtrisés.
- Quotas et isolation testés; charge croissante et budgets p95 mesurés, pas une
  promesse de capacité basée sur une petite démo.
- Sauvegarde des dossiers/scénarios Pulsar, restauration et replay du moteur.
- Un seul point d'entrée public `pulsar.intebec.ca`; aucun déploiement avant
  confirmation de la topologie Docker/Nginx du VPS.

## Vérification réalisée pendant cet audit

- CI de la PR #79 et CI de son merge sur `main` : succès constaté sur GitHub.
- Comparaison des fichiers applicatifs Python, revue des contrats et UI source.
- CLI du moteur embarqué, sans DB ni persistance :
  - `schedule --demo --strategy greedy` : 12 affectations pour 5 ordres.
  - `schedule --demo --dataset industrial --strategy greedy` : 22 affectations
    pour 6 ordres, diagnostics matières et chemin critique retournés.
- Ces deux smoke tests ne valident ni les autres solveurs, ni l'intégration HTTP,
  ni la charge industrielle. `pytest` est absent du venv APS local : la suite
  Python complète n'a pas été exécutée et aucune dépendance n'a été installée.
- Aucun code métier modifié, aucune migration, aucun envoi externe, aucune écriture
  dans PlaniAdvance, aucun push ou déploiement pendant cet audit.

**Prochain lot recommandé : A**, puis B. Ne pas livrer un accueil décoratif qui
laisserait la majeure partie du moteur inaccessible.

### Après l'audit : premier incrément A1

Le lot A1 est implémenté sur cette branche : [contrat, vérifications et limites](./manufacturing-aps-foundation.md).
Les constats ci-dessus décrivent l'état audité **avant A1**, pas le comportement
de la nouvelle passerelle. Le lot A reste partiellement ouvert; la refonte du
Gantt et la parité industrielle avancée ne sont pas déclarées livrées.
