# Pièces Services et documentation des connexions

> Complément du 25 septembre : [lots explicites des pièces Services](services-part-lots.md),
> identité figée et retours au lot d’origine; aucune déduction sur l’historique.

> Évolution du 22 septembre : les limites de retour intégral décrites dans ce lot
> historique sont remplacées par les [retours partiels et la facturation nette](services-partial-returns.md).
> Les invariants de sortie physique, de snapshot et de verrouillage restent applicables.

Lot local du 21 septembre 2026, branche `codex/end-user-workflows`. Suite de
[l’approbation des heures](services-time-approval.md). Pas de push/PR ni de déploiement externe.

## Résultat utilisateur

1. Catalogue → produit GOODS → **Stock WMS** : lier explicitement un article WMS actif de
   même unité. Correspondance un-à-un, indépendante du code/nom. Aucun stock créé.
2. Services → intervention en cours → **Pièces et stock** : choisir le produit, un emplacement
   disposant de stock, quantité et note; confirmer le mouvement physique.
3. La sortie WMS et la consommation Services sont atomiques. Historique avec quantité,
   désignation, code, unité, emplacement, dates, motifs et identifiants des mouvements.
4. **Retourner les pièces** : retour intégral motivé à l’emplacement d’origine, qui doit être
   actif. Ne confirmer que si les pièces sont réellement revenues. La sortie originale reste
   dans le journal. Pour corriger une quantité, retourner intégralement puis saisir la bonne
   consommation tant que l’intervention est en cours.
5. Navigation directe intervention → journal WMS filtré → intervention. Le lien retour du
   journal n’est exposé que si Services est activé et que l’utilisateur possède services.read.

## Autorités métier et droits

| Domaine              | Propriétaire                   | Ce que le lien ne fait pas                  |
| -------------------- | ------------------------------ | ------------------------------------------- |
| Identité commerciale | CatalogItem                    | Ne tient aucun solde de stock               |
| Article physique     | WmsItem                        | Ne fusionne pas CRM/TMS/Catalogue           |
| Correspondance       | CatalogStockLink               | Ne copie ni nom, prix ou stock              |
| Pièce utilisée       | ServicePartUsage               | Ne remplace pas le mouvement WMS            |
| Stock                | StockMovement + InventoryLevel | Ne calcule ni prix facturé ni coût Services |

La gestion du lien exige Catalogue activé et catalog.manage + wms.read, avec WMS activé.
Sa lecture exige catalog.read + wms.read. Consommer/retourner exige Services/WMS activés et
services.read/manage + wms.read/manage. Pas de droit stock implicite par affectation ou par
services.time.write. Les références de produit et de stock exigent services.read + wms.read.
Les snapshots de consommation restent lisibles sous services.read après désactivation de WMS;
ils appartiennent au dossier Services, pas à une lecture du stock actuel.

## Sécurité, transactions et reprise

- Tables métier distinctes, FK composites tenant/id, référence de mouvements unique par tenant.
  Les acteurs sont également liés aux utilisateurs du même tenant. Chaque quantité est positive.
- Ordre de verrou commun : mutex `business:<tenantId>`, puis ligne tenant WMS `FOR UPDATE`.
  Relecture du projet/intervention, validation des articles/emplacements et écriture dans une
  transaction. `InventoryService.postMovement` reste le seul writer du solde et du journal.
- La consommation crée un PICK, le retour un RECEIPT, tous deux `refType=service-job`.
  Aucun nouvel état WMS inventé, aucun solde modifié directement. L’effet retour est dérivé
  du mouvement compensatoire, sans suppression ou édition de la sortie.
- La version de l’intervention progresse sur chaque mouvement; une ancienne version est refusée.
  Les actions de clôture partagent le mutex, empêchant une écriture après fermeture concurrente.
- Idempotence séparée consommation/retour : clé UUID durable + empreinte du corps, acteur,
  intervention et version attendue. Replay reconnu sous verrou avant les validations de stock
  et de statut. Même clé avec autre contenu → 409. Les droits/modules restent vérifiés au replay.
- L’UI conserve la demande exacte avant envoi dans un espace navigateur tenant/utilisateur/
  intervention. Réponse incertaine → pas de nouvelle demande; bouton de reprise avec même clé,
  y compris après rechargement. Stockage indisponible/illisible → aucun nouvel envoi.
- La quantité affichée par le sélecteur n’est pas réservée. Le writer revérifie la disponibilité.
- Changements d’unités WMS bloqués si correspondance ou consommation historique; noms et codes
  peuvent évoluer sans réécrire les snapshots. Les mises à jour WMS prennent le même verrou de stock.
- Retirer/remplacer la correspondance ne modifie pas les consommations ni leurs retours. Un retour
  reprend l’article/bin/unité capturés; il ne suit pas une nouvelle correspondance.
- Audit après commit, selon le service best-effort existant. La preuve atomique reste le mouvement
  lié à la consommation, même si l’audit secondaire est indisponible.

## Statuts, clôture et limites

Consommation uniquement sur intervention IN_PROGRESS et projet ACTIVE. Aucun mouvement au
démarrage, à la saisie du temps ou à la clôture. Annuler l’intervention est refusé s’il reste des
pièces non retournées; si elles ont réellement été utilisées, terminer avec un compte rendu.
Retour possible après complétion de l’intervention tant que le projet reste actif. Le projet
fermé fige ses pièces; aucun retour implicite à son annulation. Les quantités d’articles/unités
différents ne sont jamais additionnées en un faux total.

Non livré : retour partiel, autre emplacement de retour, réservation, lot/série/péremption,
stock mobile de technicien, coût valorisé, facturation, signature, mode hors ligne complet,
événements ou nouveaux outils AI. Les scanners existants ne sont pas élargis à un protocole
matériel par ce lot. Facturation Services et réception liée aux achats restent explicitement
annoncées **non connectées**.

## Documentation directement dans Pulsar

`/documentation?view=connections` ajoute 24 fiches couvrant les 22 espaces internes.
Une fiche définit : propriétaire de la donnée, prérequis/droits, déclencheur, informations
transmises, effet réel, absence d’effet automatique et correction/reprise. Cinq catégories :
référence, action métier, contexte, automatisation configurée, non connecté actuellement.

Les mêmes fiches sont intégrées dans chaque guide concerné, pas copiées dans plusieurs pages.
Recherche insensible aux accents dans leur contenu, sommaires ancrés, liens vers les guides
accessibles, vocabulaire métier, dépannage et trois parcours de bout en bout. Les modules non
autorisés sont nommés comme dépendances sans lien ouvrable; aucune donnée tenant n’est consultée
pour afficher le manuel. Les articles restent filtrés par les accès existants.

L’aide et les tutoriels Catalogue/Services ont été mis à jour. Les visites déjà terminées ne
sont pas forcées une deuxième fois; le bouton Tutoriel permet de les relancer. La documentation
est éditoriale/versionnée, pas une détection dynamique de la santé des connexions.

### Sources à revérifier lors d’une évolution

- Catalogue/Services/Achats : `apps/api/src/modules/business` et `packages/shared/src/business.ts`.
- Stock : `wms/inventory`, `wms/picking`, `wms/receiving`, règles AGENTS 33 et 40–42.
- Cour : `yard` et [dossiers connectés](yard-connected-dossiers.md).
- Flotte : `fleet`, règles AGENTS 32 et 43.
- Transport/Facturation : workflows et coûts figés, règles AGENTS 16/19/31.
- Capture Sites/CRM : `sites/sites.public.service.ts`; portail : `customer-portal`.
- Agents/Analytics/Connect : registres d’outils, governance, flow et outbox existants.

Lorsqu’un contrat change, mettre à jour `apps/web/src/lib/help/connections.ts`, l’aide locale
et les tests associés. Ne pas transformer une fonctionnalité prévue en promesse livrée dans
un texte marketing. Les tests de structure ne prouvent pas à eux seuls tous les contrats anciens.

## Environnement et vérification

Migrations additives `20260922010000_services_parts` et `20260922011000_service_parts_return_guard`,
appliquées uniquement sur `pulsar_enduser_20260921` (90 migrations). `.env` et base utilisateur
inchangés. Aucun rapprochement automatique ni backfill de pièces historiques.

Tests ciblés : compatibilité/unicité/FK/droits de correspondance; stock court et rollback;
concurrence de sorties/replays/retours; snapshots après déliaison; projets clos; modules
désactivés; demande navigateur durable; navigation intermodules et documentation mobile.
Résultats de la recette locale :

- 1 480 tests unitaires réussis : shared 846, API 526, web 108.
- 122 tests HTTP/PostgreSQL réussis dans 9 suites : business-foundations, configurable-wms-yard-fleet,
  wms-movement-traceability, wms-workspace, wms-guided-operations, wms-module, wms-fulfillment,
  scanning-tours et end-user-workflows.
- 34 scénarios navigateur réussis : business-foundations, end-user-workflows et scanning-tours.
  Inclut sortie réellement commise avec réponse perdue, reprise après rechargement sans doublon,
  retour intégral et aller-retour intervention/journal WMS; documentation filtrée sur mobile.
- Typecheck sans erreur (12 avertissements préexistants); compilation complète réussie.
- Diff Prisma base isolée → schéma vide; formatage ciblé et `git diff --check` réussis.
- Recette visuelle du manuel en navigateur : recherche, sommaire ancré et fiche Services ↔ WMS.

Cela ne remplace pas une recette de tous les anciens modules ni un essai avec lecteurs matériels.

## Suite recommandée

Connecter les **commandes fournisseurs aux réceptions WMS**, avec correspondance explicite des
articles, livraisons partielles, reliquats, idempotence et trace des lignes. Ensuite : devis et
facturation Services sur heures approuvées et pièces nettes de retours, en figeant prix/taxes/
versions pour empêcher toute correction silencieuse d’une pièce ou heure déjà facturée.
