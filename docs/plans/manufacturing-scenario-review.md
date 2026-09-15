# Fabrication — fuseau explicite et revue des scénarios (A2.1)

15 septembre 2026 · branche `codex/manufacturing-visual-workspace`.

Ce lot prolonge [A1](manufacturing-aps-foundation.md). Il ne termine pas tout A2 et
ne remplace pas le Gantt par une application React : bureau, navigation, polices,
couleurs et composants restent ceux de Pulsar.

## Parcours livré

1. **Nouveau scénario** ouvre un Drawer Pulsar animé : stratégie, date de début,
   durée et fuseau IANA explicite. Les réglages ne déplacent plus le contenu.
2. Le moteur calcule une simulation, sans modifier le plan publié ni le WMS/TMS.
3. **Revoir le scénario** ouvre une revue en lecture seule : écarts de durée,
   retards et ponctualité, opérations modifiées/ajoutées/retirées, changements de
   poste et raisons de blocage. Les données manquantes ne deviennent pas zéro.
4. **Confirmer la publication** transmet l'empreinte de la revue. Le serveur
   réévalue le moteur et les données avant la publication gardée A1.
5. Après une réponse incertaine, la confirmation est désactivée. **Vérifier l'état**
   relit le scénario avant toute nouvelle tentative; aucune relance automatique.

Les noms du Gantt viennent du snapshot capturé lorsqu'il existe : plus de requête
supplémentaire par ordre ni de remplacement silencieux des libellés historiques
par les noms actuels. Les réponses tardives d'une ancienne sélection sont ignorées.
L'historique indique explicitement sa limite actuelle de 50 scénarios affichés.

## Temps et compatibilité

- `POST /manufacturing/scheduling/run` accepte `timeZone` (IANA), `horizonDate`
  (`YYYY-MM-DD`) et `horizonDays` (1–365). L'UI transmet toujours le fuseau, UTC par
  défaut. Sans `horizonDate`, l'API utilise la date courante **dans ce fuseau**.
- Le fuseau est **commun aux calendriers d'un scénario**, pas un nouveau modèle
  multi-sites. Les dates de disponibilité/échéance des ordres restent des instants
  UTC; elles ne sont pas réinterprétées comme heures locales.
- L'API convertit les quarts locaux en fenêtres UTC concrètes à la frontière du
  moteur (`plant-time.ts`, Intl/IANA), et les capture dans `inputRequest.calendar_windows`.
  Les horizons de 23/25 heures traversant DST sont conservés via `horizon_end`.
- Heure ambiguë ou inexistante (début/fin de quart ou borne d'horizon) : refus 400
  explicite. Aucun choix silencieux d'offset. Les quarts se terminent le même jour;
  le support nuit/24:00 reste à concevoir.
- Contrat `pulsar.aps.v2`, révision `planiadvance-d26a8cd.pulsar-a2`. Le moteur utilise
  les fenêtres capturées, sans recompilation par sa base de fuseaux. Le rejeu est
  donc indépendant d'une mise à jour ultérieure des règles IANA.
- `WorkingCalendar.resolved_windows=None` préserve le comportement hebdomadaire
  historique; `[]` signifie fermé. Une liste concrète remplace l'expansion
  hebdomadaire. Le codec canonique interne inclut ces fenêtres dans l'empreinte
  moteur. Toute future transformation/clone de calendrier doit les préserver ou
  les recalculer explicitement — jamais revenir implicitement aux quarts locaux.
- L'heure d'export moteur V2 vient du snapshot capturé pour stabiliser son hash.
  Les anciens calculs/rejeux V1 restent UTC avec leur sémantique A1, sans backfill.
  Les anciens clients sans `timeZone` restent V1; `horizonStart` conserve son sens
  UTC et ne peut pas être combiné avec `timeZone`.
- Limite de garde : 100 000 fenêtres par requête, vérifiée des deux côtés. Ce n'est
  pas encore un système complet de quotas ou un benchmark de charge.

## Revue et gouvernance

- `GET /manufacturing/scheduling/runs/:id/review` : `manufacturing.read`, module
  activé, tenant issu du JWT. Appelle `/internal/pulsar/review` avec la clé de service.
- `PublishScenario.assess` expose la décision du même use case que la publication;
  il ne modifie même pas le cycle de vie du repository éphémère. `CompareScenarios`
  calcule les écarts; il n'y a aucun second moteur de score TypeScript.
- `reviewToken` lie scénario, hash d'entrée, baseline attendue, révision des dossiers
  et résultat de revue. L'UI l'envoie au POST de publication; changement ⇒ 409.
  Le gate et les contrôles transactionnels A1 restent obligatoires.
- La revue n'est ni un verrou longue durée ni une réservation. Elle constate la
  fraîcheur des dossiers de fabrication, pas la disponibilité réservée des matières.
- Le token reste optionnel pour les anciens clients/outils agents, **sans** lever
  le gate moteur. Aucun `allowReview`/`acceptReview` n'est exposé par l'API Pulsar.
  Un état moteur `review` ou `blocked` exige une correction/recalcul, pas une
  publication forcée. Les actions d'agents restent dans leur gouvernance existante.
- Rejeu historique, artefact incomplet, scénario remplacé ou baseline changée :
  revue/publication refusées avec une instruction de recalcul. Aucun ancien run
  n'est réparé en inventant ses données.

## Vérification locale

- Python : 635 tests du périmètre domain/scheduling/integration/bridge réussis,
  7 tests lents désélectionnés par la configuration existante. Greedy/backward/CP-SAT
  utilisent les fenêtres capturées; calendrier fermé, DST, hash/rejeu et refus testés.
- API : 274 tests unitaires; 14 tests HTTP + PostgreSQL réussis avec le stub, puis
  avec le vrai moteur sur un port de test dédié. V1/V2, isolation/droits, revue sans
  écriture, token périmé, rejet du forçage et baseline concurrente couverts.
- Navigateur : 6 tests Playwright sur contrats simulés (pas des preuves du moteur),
  dont lecture seule, erreurs, publication incertaine, navigation clavier, largeur
  tablette et capture visuelle des deux panneaux. L'intégration moteur réelle est
  qualifiée séparément par les tests HTTP ci-dessus.
- `pnpm build` et `pnpm typecheck` réussis; 12 avertissements Svelte préexistants
  dans 5 fichiers, aucun dans l'écran modifié. Page et panneau ouverts/vérifiés
  également dans le navigateur local connecté, sans créer de données métier.
- Aucun schéma/migration ni donnée métier de développement modifiés dans ce lot.
  L'application locale utilise la base existante `pulsar_relaunch_20260913` par
  variable du processus, sans modifier `.env` (qui pointe encore vers une ancienne
  base absente). Aucun push ni exécution GitHub Actions dans ce lot.

## Suite, dans cet ordre

1. Baseline comme **entrée** de replanification, portée de réparation et actions
   planificateur; pour l'instant elle sert à la comparaison/publication seulement.
2. Exécution réelle, temps restant et gel : préserver strictement les opérations
   démarrées, puis exposer les capacités réellement supportées par stratégie.
3. Modèle sites/calendriers/fuseaux, nuit, unités et fraîcheur des matières; quotas
   de calcul et mesures de charge avant de promettre une planification multi-usines.
4. Arbitrage humain documenté et audité pour l'état `review`, sans permission de
   forçage implicite aux agents. Un état `blocked` demeure non contournable.
5. Gantt métier avancé (zoom, sélection, conflits, aperçu des déplacements) avec les
   primitives Pulsar; pas d'édition visuelle sans validation serveur.
