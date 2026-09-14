# Relance : exploitation, dossiers et poste de travail

Branche : `codex/control-center-workflows`. Base : `fe9a938`.

## Périmètre accepté

1. Console d'exploitation SaaS distincte du cockpit tenant : santé fonctionnelle,
   files durables, configuration, entreprises, catalogue des modules.
2. Dossier intermodule calculé à la lecture : commande commerciale, transport,
   expéditions, préparation, livraison, facture et décisions. Pas de nouvelle
   machine d'état ni de promesse de reprise automatique.
3. UX de travail : listes compactes, filtres conservés, panneau contextuel,
   liens directs, clavier et états vides/erreur explicites.

## Audit de départ

- Svelte 5 SPA, Tailwind 4, Geist/Geist Mono, composants maison et thèmes existants.
- Réutiliser Drawer/Table/CommandPalette ; ne pas remplacer le framework, les
  icônes ni la palette globale. L'objectif est la lisibilité opérationnelle.
- L'admin ne dispose que de la liste des tenants et de trois modules codés en dur.
- La readiness publique vérifie PostgreSQL et l'installation des runtimes ; elle
  ne représente pas leur disponibilité fonctionnelle. Préserver ce contrat.
- La trace existante est centrée transport et ne décrit pas la chaîne commerciale.
- Les compteurs sans observation, les connexions simplement configurées et les
  dépendances non installées doivent être distingués d'un service opérationnel.

## Contrats de sécurité et de vérité

- `/platform/**` : JWT de plateforme obligatoire via `PlatformController` ; un JWT
  tenant n'est jamais suffisant. Aucun secret, contenu d'email ou payload métier.
- Dossiers : tenant du JWT, analytics activé + permission analytics ; projection
  de chaque module conditionnée par son activation et sa permission de lecture.
- Requêtes bornées, résultats incomplets annoncés, erreurs non assimilées à zéro.
- Actions de correction : navigation vers les fonctions existantes, jamais un
  bouton qui rejoue aveuglément une opération sensible.
- Tests de santé sans email sortant, appel LLM payant ni mutation métier.

## Qualification

- Tests des états de santé et absence de données sensibles.
- E2E plateforme : anonyme/tenant refusés, admin autorisé.
- E2E dossier : chaîne réelle, droits partiels, module désactivé, cross-tenant.
- Typecheck, unitaires, build, parcours UI bureau/mobile et clavier.
- Environnement OVH : VPS Linux, Docker + Nginx existant,
  `pulsar.intebec.ca`. Préparer un profil isolé ; aucun déploiement distant avant
  vérification du serveur, du DNS et du TLS. Pas de compte démo par défaut exposé.

## Implémentation — 2026-09-13

### 1. Console d'exploitation

- Navigation plateforme dédiée : Exploitation, Entreprises, Catalogue.
- `GET /platform/operations` : API, PostgreSQL (sonde réelle), APS (processus et
  readiness de sa base séparés), installation Hermes, email, stockage, sauvegardes.
- Observations bornées à 5 secondes ; absence de mesure distincte d'un résultat
  positif. La garde plateforme nécessite elle-même la base pour relire le statut
  opérateur : **une panne totale de PostgreSQL peut empêcher d'ouvrir le cockpit**.
  Une supervision externe reste nécessaire. Le timeout d'observation n'annule pas
  une requête PostgreSQL déjà en cours.
- Files durables : événements, runs agents, propositions, webhooks, email sortant.
  Compteurs d'historique et âge d'attente, pas faux heartbeat de worker.
- `GET /platform/operations/tenants/:id` : diagnostic réduit, sans usurpation de
  session, sans contenu métier ni secrets. Configuration IA ≠ connexion vérifiée.
- Création entreprise : tous les modules disponibles du catalogue partagé,
  recherche/filtre, confirmation de suspension/réactivation. La liste d'entreprises
  reste chargée en une requête comme avant ; pagination serveur à prévoir à l'échelle.

### 2. Dossier connecté

- `GET /analytics/flow/dossier?entityType=…&entityId=…`, calculé à la lecture,
  aucune migration. Racines : `SALES_ORDER`, `TRANSPORT_ORDER`, `SHIPMENT`, `LOAD`.
- Liens persistés vente → transport → expéditions → chargements/préparation →
  factures client. Lecture des états sources, jamais une nouvelle transition.
- Historique des événements et tâches liés aux objets visibles ; propositions
  agents reliées aux tâches par `triggeredByRef`, sans arguments ni résultats bruts.
- Chaque famille exige activation + permission de lecture correspondante. Analytics
  seul ne donne pas accès au CRM, TMS, WMS ou Billing. Aucune requête cross-tenant.
- Plafond de 100 par famille/historique ; la troncature est annoncée. Vue non
  transactionnelle : une mise à jour concurrente peut nécessiter une nouvelle lecture.
- Panneau depuis la liste, les détails commande commerciale/transport/load et le
  détail d'expédition. Liens profonds vers expédition, tâche et relevé client.
- Ne couvre pas encore les liens fabrication/cour, les pièces jointes, tous les
  AuditLog ni les réactions automatiques ; les liens manquants ne sont pas inventés.
  Les décisions sans lien à une tâche restent dans l'espace Actions agents.

### 3. Poste de travail

- `/workflows` : recherche, statuts provenant des enums partagés, pagination 25,
  dix vues personnelles maximum, isolées par utilisateur et entreprise sur l'appareil.
- Les vues sont sauvegardées explicitement, non synchronisées entre appareils.
  Les filtres sont conservés pendant l'ouverture/fermeture d'un dossier ; après une
  nouvelle navigation, l'utilisateur peut réappliquer sa vue enregistrée.
- Barre transversale : ma file, dossiers, densité des tables et navigation rapide.
- Drawer accessible avec Échap/retour du focus, erreurs avec reprise, chargement
  explicite et protection contre les réponses périmées lors d'un changement de dossier.
- Défaut trouvé en recette : les libellés répétés « Configuration » faisaient planter
  CommandPalette. Liste rendue sans clé métier fondée sur le libellé, nom accessible,
  focus et navigation clavier renforcés ; régression couverte par Playwright.
- La recette mobile du cockpit a aussi détecté un débordement dû aux en-têtes
  `sr-only` positionnés hors du conteneur défilant. Le composant Table fournit
  maintenant leur bloc de référence (`position: relative`) ; le contenu reste
  accessible par défilement interne sans élargir la page.

### Déploiement préparé

Voir [deploy/ovh/README.md](../../deploy/ovh/README.md). Profil Docker dédié, seul
port publié sur `127.0.0.1:8180`, Nginx/TLS sur le VPS existant, stockage persistant,
bootstrap catalogues + opérateur sans seed démo, MFA plateforme imposé. Un bootstrap
répété ne réinitialise ni mot de passe, ni statut, ni MFA.

Le script `node scripts/test-ovh-smoke.mjs` qualifie ce profil **localement** avec
secrets éphémères et projet Docker jetable, puis nettoie uniquement ses propres
conteneurs/volumes. Prérequis : construire les images API et web portant le tag
`control-center-test`. Il ne se connecte pas au VPS.

### Preuves de recette

- `pnpm test` : **816 tests unitaires** (573 shared + 218 API + 25 web).
- `pnpm typecheck` : aucun défaut de typage ; 41 avertissements Svelte préexistants.
- API ciblée : **67/67**, dont 14 nouveaux contrats plateforme/dossier.
- `pnpm --filter @pulsar/web exec playwright test --workers=1 --reporter=line` :
  **21/21** (desktop, tablette, mobile ; trois nouveaux parcours).
- UI manuelle : vue restaurée après rechargement, dossier, fermeture Échap avec
  retour du focus, console d'exploitation, diagnostic tenant ; largeur 390 px
  sans débordement de la page (tables à défilement interne).
- Builds Docker API et web réussis. Smoke OVH local : migrations, bootstrap répété
  sans modification du hash, aucun tenant démo, SPA fallback, proxy API, refus anonyme,
  login exigeant l'enrôlement MFA, redémarrage/readiness ; nettoyage réussi.
- Suite API globale : **610 réussis, 8 échecs, 1 ignoré sur 619** au premier passage
  (66 suites réussies, 4 en échec, 1 ignorée ; 206 secondes).
  - Un défaut d'isolation du test cash-flow : solde global comparé au montant d'un
    paiement malgré les décaissements des autres suites. Corrigé pour vérifier le
    **delta exact**, sans changer le calcul comptable. Suite `reports` rejouée :
    **9/9 réussis**, notamment sur la même base contenant les données antérieures.
  - **7 échecs restent non qualifiés**, dans `aps-runtime`,
    `manufacturing-scheduling` et `manufacturing-agent-tools` : APS répond mais sa
    base est absente/non prête ; les tests de solve renvoient 500/503, puis leurs
    assertions dépendantes échouent. Pas de modification ni de skip ajouté pour
    cacher cette dépendance. La suite globale n'est donc **pas déclarée verte**.

Le lot exploitation/dossiers/UX est validé sur ses parcours. La qualification du
moteur APS et du déploiement distant reste un prérequis avant une recette globale
de planification/fabrication. Le profil OVH documente volontairement cette limite.

## Prochain lot recommandé

1. Inspecter le VPS (Nginx hôte/conteneur encore inconnu), DNS/TLS, espace disque,
   stratégie de sauvegarde et restrictions du pilote ; déployer la révision revue.
2. Recette sur données fictives de bout en bout et restauration dans une base isolée.
3. Configurer et qualifier SMTP, stockage distant et runtime agents/APS séparément.
4. Compléter la vue dossier fabrication/cour/documents à partir de vrais liens métier,
   puis tester les policies agents sur ce parcours avant d'augmenter leur autonomie.

## Limites conservées

Une seule instance API. Files agents en mémoire, événements best-effort, runtime
Hermes/APS et intégrations externes à qualifier séparément. Les sauvegardes ne
sont pas déclarées valides sans test de restauration.
