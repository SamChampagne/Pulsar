# MRP M2.2b1 + M7a — unités commerciales et worker IA

Livraison locale du 2026-09-15. Prolonge M2.2a, sans changer le moteur
PlaniAdvance ni l'identité visuelle Pulsar. Ce n'est pas encore un MRP complet
exécutant achats/atelier, ni une qualification du modèle IA pour une usine.

## Parcours opérateur

1. **Fabrication → Besoins matières → Demande → Produits et unités** : choisir
   explicitement un produit CRM et un article WMS. Exemple : 1 boîte = 12 EA.
   Le numérateur exprime la quantité WMS, le dénominateur la quantité commerciale.
2. **Relier une commande client** : sélectionner une ligne confirmée puis
   **Utiliser cette correspondance**. Vérifier l'aperçu (2,5 boîtes → 30 EA), la
   date, le site et éventuellement la prévision remplacée. Confirmer le ratio.
   Sans correspondance, le rattachement 1:1 explicite de M2.2a reste disponible.
3. Calculer. Les besoins, la consommation des prévisions et les propositions
   utilisent les quantités WMS; aucun mouvement de stock n'est effectué.
4. **Agents → Nouvel agent → Analyste MRP (worker)** : nommer le worker et garder
   le niveau **Propose tout** pour le démarrage. Configurer et tester le runtime
   du tenant dans les réglages Agents, avec les mécanismes de clés chiffrées/OAuth
   existants. Aucune clé ni aucun agent ne sont créés par la migration.
5. Dans un calcul, déplier **Assistance IA du calcul**, puis demander une revue.
   Le suivi distingue demande, exécution du worker et synthèse enregistrée.
   **Actualiser** relit le suivi; ce lot ne fait pas de polling en continu.
6. Consulter les tâches et les **Approbations IA**. Avec le rôle proposé, la
   synthèse est enregistrée après approbation. Ses articles cités ouvrent le
   détail du calcul. Un recalcul approuvé crée un nouvel historique, pas un OF.

Sans worker admissible, la tâche reste non assignée : la créer ne signifie pas
qu'une analyse a eu lieu. Après configuration d'un worker, affecter la tâche
existante depuis le Workbench; l'affectation n'est pas réécrite automatiquement.
Le dispatcher existant assure les réveils et son rattrapage périodique. Un runtime
absent/indisponible utilise ses statuts SKIPPED/FAILED et ses reprises existantes,
sans arrêter le MRP. Une tâche en cours n'est pas résolue par la seule rédaction
d'une synthèse. La décision de traitement reste à l'opérateur.

## Contrats des unités

- `MrpProductMapping` est unique par `(tenantId, productId)`. Produit, article,
  libellé et ratio explicitement validés; produit CRM et article WMS actifs.
  Lecture paginée et filtrable, édition sous verrou tenant + `expectedUpdatedAt`.
- `convertMrpCommercialQuantity` est pur/browser-safe et exact en BigInt.
  Quantité commerciale à 3 décimales, ratio positif à 6 décimales, bornes de
  1 milliard. Tout résultat non exact à 3 décimales est refusé, jamais arrondi.
  Ce ratio ne représente ni conversion physique universelle ni densité.
- La quantité commerciale vient exclusivement de la ligne CRM. À la création,
  `mappingId` + `expectedMappingUpdatedAt` sont revérifiés pour le produit/article
  exact. Le serveur conserve quantité source, quantité convertie, unité et ratio
  dans `MrpEntry.sourceSnapshot`. L'entrée stocke la quantité convertie.
- Modifier/désactiver une correspondance affecte les nouvelles demandes seulement.
  Le site, l'article, la source et la convention d'une demande restent immuables.
  Un replay identique de création renvoie l'entrée existante. Une convention
  différente ou une version périmée est refusée. Aucun rattachement implicite par nom.
- Les nouveaux `MrpRun.sourceMetadata.salesDemands` capturent aussi article,
  unité, quantité commerciale et ratio. Les anciens instantanés ne sont jamais
  backfillés; l'enrichissement d'empreinte peut les signaler à recalculer.
- SKU/unité WMS référencés par une correspondance sont protégés par le verrou
  WMS partagé. La consommation de prévision reste `deriveDemandCoverage`;
  2,5 boîtes de 12 remplacent 30 EA de prévision, pas 2,5.

## Contrat IA et gouvernance

Le circuit est celui de Pulsar, sans second ordonnanceur ni appel direct au LLM
depuis le calcul :

`MrpRun → DomainEvent → OperationalTask → AgentWorkerService → MCP → ProposedAction → MrpReview / nouveau MrpRun`

- `manufacturing.mrp.review-requested` produit une tâche `MRP_REVIEW`, dédupliquée
  sur le calcul (`MRP_REVIEW:<runId>`). Son contenu générique ne révèle pas les
  quantités ou les clients. Le Control Tower de flux l'attribue à Fabrication.
- Affectation automatique seulement à un agent ACTIVE, alwaysOn, configuré pour
  cette catégorie, avec permissions, modules et outils nécessaires. Même contrôle
  avant le claim du worker. CRM est requis si l'historique contient des sources CRM.
- Outils READ : `get_mrp_workspace`, `get_mrp_run`. Lectures tenant/site-scopées,
  droits Fabrication/WMS et droits CRM dynamiques, historique/fraîcheur calculés
  par les services MRP. Aucun calcul de besoins ou de conversion par le LLM.
- Brief borné : 20 articles/page, 31 dates/article, 20 raisons/sources par point,
  100 propositions/alertes/demandes/arrivages; totaux de troncature exposés. Filtrer
  par article pour approfondir. Le poste complet reste la référence pour les grands
  dossiers; ne pas prétendre qu'une vue tronquée est une analyse exhaustive.
- Outils MUTATING : `submit_mrp_review`, `recalculate_mrp`. Passage exclusif par
  `handleMutatingTool`, policies et plafonds existants. Le preset est PROPOSE;
  une autonomie différente reste un choix explicite gouverné, pas un bypass.
- La synthèse exige le jeton signé du worker portant `task:<id>`, la tâche de ce
  calcul affectée à cet agent et toujours OPEN/IN_PROGRESS, et son service-user.
  Articles cités appartenant au résultat, texte ≤ 8 000 caractères, texte affiché
  échappé. `MrpReview` append-only et idempotent sur le hash du contenu/contexte.
  Ses IDs de tâche/agent/auteur sont des références de provenance contrôlées en
  service; pas de cascade de suppression du compte vers l'artefact.
- L'approbation conserve `triggeredByRef` et revérifie aussi l'allowlist courante,
  en plus de l'état agent, des permissions/modules et du claim atomique existants.
  Pause, retrait de droits CRM ou d'un outil empêchent l'exécution correspondante.
- Le rôle n'expose pas `resolve_task` (outil LOW historique), ni les writers de
  stock, achats ou OF. Une analyse n'est pas une résolution de pénurie.
- `mrpAutomaticReview` (réglages Fabrication) est **false par défaut**. Activé,
  il produit une tâche après un calcul humain comportant des alertes. Un recalcul
  agent ne réémet pas cet événement, même avec le réglage activé : pas d'auto-boucle.
- Événements best-effort, tâches dédupliquées, échecs terminaux conformément aux
  règles Operating existantes. Une demande déjà enregistrée n'est pas rejouée
  automatiquement après échec. En réponse incertaine : inspecter/actualiser.

## API et migration

Sous `/api/v1/manufacturing/mrp` :

- `GET/PUT product-mappings` : Fabrication/WMS/CRM, `manufacturing.read|manage`,
  `wms.read`, `crm.read`; nouvelles FK vérifiées, audit de la mutation.
- `GET runs/:id/assistance` : lecture MRP + `core.operating.tasks.read`.
- `POST runs/:id/request-review` : mêmes droits + `core.operating.tasks.manage`.
- `sales-demands` accepte en plus la correspondance et sa version; aucune quantité
  client n'est acceptée dans le DTO.

Migration additive `20260915210000_mrp_mappings_reviews` : deux tables, relations,
indexes, unicité et contraintes de ratios positifs. Pas de seed/reset, conversion
des anciennes lignes, activation d'agent ou modification de configuration externe.

En local, utiliser la base `pulsar_relaunch_20260913`, pas l'ancien nom
`pulsar_aps` du fichier `.env`. Le serveur dev utilise API 3100 / web 5173.
Le worker lit `APP_URL` pour joindre MCP : démarrer avec `APP_URL=http://localhost:3100`
si l'API est sur ce port. Ne jamais exposer directement le bridge APS sur Internet.

## Vérification et limites

- 43 tests HTTP/PostgreSQL ciblés MRP, CRM et bridge APS réel : ratios/exactitude,
  versions/replay, source figée, droits/tenants, task→worker→MCP, proposition puis
  approbation concurrente, contexte signé, pause/allowlist/droits retirés,
  opt-in automatique et absence de boucle ou d'effet stock.
- Le moteur MRP est le vrai Python PlaniAdvance pour cette passe. **Le runtime
  conversationnel est simulé dans le test worker** : aucun fournisseur LLM réel,
  coût, qualité de synthèse ou fiabilité 24/7 n'est déclaré validé par ces tests.
- 10 tests HTTP supplémentaires de non-régression des agents/MCP (phases 11/11b).
- 658 tests shared et 284 tests unitaires API. 27 parcours UI MRP/BOM/APS sur réponses contrôlées,
  desktop/mobile, conflits, saisie conservée, configuration et échappement texte.
  Les captures de test ne sont pas des données métier réelles.
- Build complet réussi; typecheck web sans erreur (12 avertissements Svelte
  préexistants hors lot). Migration appliquée aux bases locales dev/test sans
  reset; comparaison Prisma/BD vide sur les deux bases. Aucun push/déploiement.
- Relance locale vérifiée : web 5173 répond 200, readiness API 3100 et APS 8099
  répondent `ok`. Le réglage de revue automatique du tenant Acme reste false;
  aucun worker réel, dossier ou calcul de démonstration n'a été ajouté à ce tenant.

## Suite prioritaire

1. M2.2b2 : validité des versions, sites des postes/calendriers; conventions
   d'unités de nomenclature/approvisionnement au-delà du ratio commercial fixe.
2. M3 : convertir les propositions en demandes d'achat/OF, avec source immuable,
   contrôle de fraîcheur, transaction, clé d'idempotence et revue humaine;
   réceptions partielles réconciliées avec le WMS.
3. M7b : essais d'un vrai worker sur tenant de démonstration, fournisseur configuré
   volontairement, budgets et jeux d'évaluation de synthèses; alertes runtime,
   reprise après redémarrage et pagination détaillée des gros briefs.
4. M4–M6 : APS par site, réservations/atelier, matières réelles, lots,
   recettes/batchs, rendements et qualité. Discret et procédés restent la cible.
