# Pulsar — espace de travail unifié

Date : 2026-09-14. Branche : `codex/ui-workspace`, depuis `7453757`.

## Décision produit

Le bureau d’applications façon iPhone demeure l’entrée de Pulsar. Ses icônes,
dossiers, tailles, positions et arrière-plans personnalisés restent conservés.
Le reste de l’interface évolue vers un outil de travail sobre et cohérent :
navigation stable, actions lisibles, panneaux contextualisés et mouvements courts.

Références : Elitas (cadre fixe, fluidité, overlays), comparaison Fleetbase déjà
documentée dans `docs/superpowers/plans/2026-06-15-fleetbase-ops-ui-gap.md`, standards
shadcn-like adaptés aux composants Svelte existants. Aucun code Fleetbase copié,
aucune migration de framework, aucune dépendance ajoutée. Planiadvance hors périmètre.

## Livré dans ce lot

- Cadre entreprise à hauteur de viewport : en-tête fixe, navigation et contenu
  défilant indépendamment. Même principe appliqué à la console SaaS, dont
  l’authentification demeure séparée.
- Sélecteur d’applications dans l’en-tête, avec recherche et permissions/modules
  issus du catalogue existant. Dernière URL visitée par application mémorisée
  en mémoire pour l’espace connecté courant (inclut les filtres dans l’URL).
- Bureau préservé, recherche sur téléphone, dossiers utilisant le même système
  de fenêtres accessible. Les préférences enregistrées ne sont pas réinitialisées.
- Accès globaux à Mon travail, Dossiers connectés, recherche Ctrl+K et assistant
  selon les permissions existantes. Sur petit écran, accès via le sélecteur
  d’applications, la recherche et le menu utilisateur.
- Thème clair neutre, typo et en-têtes plus compacts, contrôles et tables communs
  harmonisés. Les thèmes Ardoise/Nuit et l’accent personnalisé restent disponibles.
  La clé persistée `warm` est conservée ; son libellé devient « Clair ».
- Dialogues/panneaux : transitions courtes, reduced motion, retour du focus,
  boucle Tab, priorité du dernier overlay pour Échap, verrouillage du défilement
  du fond avec compteur de références. La palette ne détourne pas Ctrl+K lorsqu’un
  autre panneau est actif.
- CRM : colonnes et automatisations en panneau latéral ; création pipeline et
  opportunité en dialogue. Les erreurs restent visibles dans le formulaire.
  Fermeture protégée des deux éditeurs longs s’ils contiennent des modifications,
  et fermeture désactivée pendant l’enregistrement.
- Transport : suppression du grand bandeau promotionnel du Dispatch ; indicateurs
  utiles et vues Carte/Kanban/Tableau conservés.
- Finance : priorités et dossiers avant la décoration ; suppression du faux bloc
  d’employé « assigné ». Les anciens totaux mélangeant potentiellement les devises
  ne sont plus présentés comme du cash. Les montants individuels des écarts gardent
  leur devise. Aucun calcul comptable ni aucune facture ne sont modifiés.
- Erreurs communes annoncées aux lecteurs d’écran, copie raccourcie, bouton de
  nouvelle tentative sur Finance. Une erreur ne ressemble pas à une file vide saine.

## Ce que ce lot ne prétend pas livrer

Il s’agit du socle global et de premiers parcours adaptés, pas d’une réécriture
individuelle de toutes les pages. Les écrans utilisant les composants partagés
héritent du style ; les composants spécifiques devront être repris progressivement.
Les vues publiques héritent des tokens, pas du cadre de navigation entreprise.

- Aucun backend métier, schéma, endpoint, droit, outil agent ou connecteur changé.
- Aucune nouvelle autonomie IA ; la gouvernance actuelle reste obligatoire.
- Aucun déploiement OVH, push ou fusion automatique.
- La mémoire de navigation ne restaure ni formulaire non enregistré, ni sélection
  locale, ni position de défilement ; elle disparaît après rechargement complet.
- La protection d’édition concerne les fermetures des panneaux CRM, pas une
  sauvegarde universelle des brouillons ou une garantie contre rechargement navigateur.
- Les confirmations natives restantes ailleurs et la traduction de tous les écrans
  ne sont pas résolues dans ce lot.
- Les tableaux de bord doivent encore remplacer leurs sommes multidevises par des
  agrégats explicites par devise, période et état. Ce lot n’invente pas de KPI financier.

## Validation

Qualification locale terminée :

- `pnpm typecheck` : tous les workspaces passent ; Svelte : 0 erreur,
  41 avertissements préexistants dans 8 fichiers.
- `pnpm --filter @pulsar/web build` : build SPA de production réussi.
- `pnpm --filter @pulsar/web test` : 28 tests unitaires passent, dont 3 nouveaux
  tests de pile d’overlays et de restauration du défilement.
- Playwright : **24 tests distincts passent**, dans les suites `workspace` (6),
  `crm-pipelines` (2), `control-center` (3), `journeys` (9), `login-page` (1),
  `responsive` (desktop + tablette : 2), `login-page.mobile` (1).
  Exécution transversale 21/21 puis exécution finale workspace + CRM 8/8
  (5 scénarios communs, non comptés deux fois).
- Vérification visuelle du bureau et du pipeline dans le navigateur ; captures
  Playwright des panneaux 1280/390 px, du bureau mobile et du dossier en thème nuit.
  Le thème nuit est injecté dans la réponse de préférences du test, sans changer
  les préférences réelles de l’utilisateur.
- API locale existante sur 3100, web sur 5173, données de relance locales ; relances
  CRM en SIMULATION. Aucun courriel externe ni SMS envoyé. Pas de migration ni
  nouvelle qualification de déploiement distant.

La suite `journeys` vérifie le montage des surfaces (tableau de bord, TMS, CRM,
WMS, Cour, Flotte, Agents, factures, Fabrication), pas toutes leurs opérations métier.

Les scénarios ajoutés dans `apps/web/e2e/workspace.spec.ts` couvrent : stabilité des
dimensions du Kanban et du cadre à 1280/390 px ; Tab/Échap/focus ; abandon de brouillon
et overlays imbriqués ; retour au pipeline sélectionné via changement d’application ;
recherche du bureau ; navigation mobile ; reduced motion ; erreur Finance sans faux
état sain. Les scénarios CRM existants valident toujours les écritures et les relances
en simulation, sans envoi externe.

## Suite, par parcours utilisateur

1. **Vendre → exécuter → facturer** : fiches CRM, commande commerciale, ordre de
   transport et facture avec même structure de résumé, relations et actions. Montrer
   ce qui est lié et ce qui manque ; pas seulement des liens vers les modules.
2. **Listes et tableaux de travail** : filtres, vues sauvegardées, colonnes, tri,
   pagination et sélection cohérents ; URL partageable et restauration de contexte.
   Ne pas introduire un autre système de vues que celui déjà présent.
3. **Mon travail et supervision** : distinguer tâches humaines, propositions à
   approuver, incidents et activité agent ; détails sur le côté, preuve et prochaine
   action visibles. Préserver la visibilité des permissions et des limites d’autonomie.
4. **WMS / Cour / Flotte / Fabrication** : appliquer les conventions aux outils
   spécifiques sans remplacer leurs cartes/Gantt/plan de cour par du CRUD générique.
5. **Durcissement transversal** : remplacer les `confirm()` restants ; brouillons et
   blocage navigation unifiés ; accessibilité des 41 avertissements Svelte historiques ;
   contraste des accents personnalisés ; qualification navigateur réelle des thèmes,
   portails et longs jeux de données.

Critère de sortie d’un parcours : réalisation d’une tâche réelle avec données de test,
mobile/tablette/desktop, clavier, données vides/chargement/erreur, droits restreints,
retour au contexte précédent et aucune régression sur les transitions métier.
