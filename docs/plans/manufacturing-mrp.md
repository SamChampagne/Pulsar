# Fabrication + PlaniAdvance — trajectoire MRP

Date : 2026-09-15. Demande : construire un MRP dans Pulsar, pour fabrication
discrète ET procédés à terme. Le bureau, la navigation et les composants Pulsar
restent la référence visuelle. Le projet PlaniAdvance original n'est pas modifié.

## Livraison M1 : calcul des besoins et poste de travail

Mise à jour M2.2a : [commandes CRM et consommation des prévisions](./manufacturing-demand-sources.md)
livrées avec rattachements explicites, provenance et droits croisés. Les conversions
d'unités, achats et exécution atelier restent des lots suivants.

Mise à jour M2.1 : voir le [référentiel versionné](./manufacturing-definitions.md).
Les politiques MAKE utilisent désormais une version publiée explicite, pas le
brouillon. Les lignes sont Decimal(24,9), et les nouveaux OF peuvent capturer
leur site et leurs matières à la libération. Les limites M2–M7 ci-dessous restent
ouvertes lorsqu'elles ne sont pas explicitement couvertes par M2.1.

**M1 est un module de planification, pas encore un MRP industriel de bout en bout.**
Il ne passe pas de commande fournisseur, ne crée pas d'OF et ne consomme aucun
stock. Cette frontière est affichée dans l'interface, pas seulement dans ce document.

Disponible dans `/manufacturing/mrp` :

- choix explicite d'un entrepôt WMS actif ; aucun cumul entre sites ;
- politiques par article : Acheter/Fabriquer, nomenclature, délai, sécurité,
  minimum et multiple ; confirmation explicite des unités ;
- demandes indépendantes et arrivages datés, activables/désactivables et éditables
  avec version optimiste ; aucune importation implicite des commandes CRM ou OF ;
- nomenclatures multi-niveaux via le SKU WMS exact ; les composants communs sont
  regroupés après calcul de tous leurs parents ;
- calcul déterministe Decimal : besoin net, arrondi, décalage des dates de lancement,
  solde projeté et provenance des besoins par article ;
- propositions d'achat/fabrication et alertes de lancement trop tardif ; arrivages
  dépassés exclus de la couverture et signalés, jamais assimilés au stock ;
- lien facultatif vers une réception WMS du même site/article : une réception
  POSTED réduit la quantité encore attendue, le stock provenant déjà du WMS ;
- calculs immuables, version moteur, snapshot et empreinte ; lecture historique
  conservée même si les données ont changé, avec avertissement de péremption ;
- table de travail sur ordinateur, cartes compactes sur mobile, panneaux Pulsar
  animés avec focus/Escape, navigation d'un composant au besoin parent.

### Architecture et contrats

`MrpItemPolicy`, `MrpEntry`, `MrpRun` appartiennent à Pulsar. Les références acceptées
passent par OwnershipService puis sont revérifiées dans les lectures/mutations
scopées. Le contrôleur exige Manufacturing ; chaque endpoint exige aussi wms.read
et les permissions Fabrication appropriées. Le service recontrôle les deux modules,
y compris pour les calculs historiques. Aucun droit WMS.manage n'est nécessaire
car M1 ne modifie aucun document ni stock WMS.

Les writers MRP prennent le verrou de ligne du tenant partagé avec les writers
WMS ; les éditions requièrent expectedUpdatedAt et font avancer la version de
façon monotone. La capture utilise une transaction RepeatableRead. L'appel moteur
est hors transaction, borné à 30 s et best-effort. Le résultat est validé au retour
(structure, tenant, contrat, articles et unités) avant sa persistance et son audit.

Le calcul réside dans `services/aps/planiadvance_v2/domain/mrp.py`, derrière le
bridge privé `/internal/pulsar/mrp` : clé de service, tenant fourni par NestJS,
aucune BD autonome, aucune mémoire inter-requêtes. C'est une extension du runtime
PlaniAdvance, **pas une prétendue réutilisation d'un moteur MRP qui existait déjà**.
Le MaterialLedger existant reste le calcul de disponibilité du solveur APS ; il
n'effectuait pas l'explosion/netting multi-niveaux du MRP.

Les quantités du bridge sont des chaînes décimales. L'ordre topologique traite
les parents avant leurs enfants et refuse les cycles, composants manquants,
nomenclatures vides et dépassements de limites. La sécurité est un plancher de
stock, non une consommation répétée. Les multiples/minimums sont appliqués au
parent avant l'explosion de ses composants. Les sommes ne mélangent jamais les
articles ni leurs unités.

### Hypothèses à ne pas masquer

- Stock actuel en bins actifs du site ; pas d'ATP, réservation ni allocation.
  Ne pas utiliser ce résultat seul pour confirmer une promesse commerciale.
- Date de référence = aujourd'hui UTC, dates de besoin explicites, horizon ≤ 730 j.
  Il ne s'agit pas d'une reconstruction de stock historique ni de jours ouvrés.
- Les réceptions du jour précèdent les besoins du jour. Les besoins antérieurs
  sont regroupés à aujourd'hui tout en gardant leur date source dans l'explication.
- Le solde projeté suppose la réalisation des propositions ; capacité infinie.
  Une alerte d'urgence n'est pas une preuve de faisabilité ni un ordre exécutable.
- BOM : quantité du composant dans son unité WMS pour UNE unité WMS du parent.
  Pas de conversion implicite KG/LB, rendement, rebut, coproduit ou lot de recette.
  Depuis M2.1 : BomLine et versions publiées sont Decimal(24,9). La migration
  refuse les anciennes valeurs Float non représentables sans arrondi.
- Arrivage manuel = quantité encore attendue. Sans réception liée, l'opérateur
  doit la réduire/désactiver après réception ; sinon le résultat peut surévaluer
  la couverture. Un lien ne constitue ni réservation ni bon de commande.
- Réception annulée liée → calcul refusé jusqu'à correction de l'arrivage.
  Une réception/article ne peut être liée qu'une fois, même à une entrée inactive.
- Les OF historiques restent sans site/version connus; les nouveaux peuvent être
  rattachés explicitement depuis M2.1. Aucune quantité restante fiable n'est encore
  dérivée : aucun OF n'est ajouté implicitement à l'offre ou à la demande.
- Pas de retry automatique des écritures. Après réponse incertaine, inspecter le
  poste/historique avant de ressaisir ; création d'entrée non idempotente à ce stade.
- Limites explicites : 2 000 politiques/articles/BOM, 10 000 entrées, 50 niveaux,
  20 000 liens de nomenclature, 100 000 besoins dépendants générés et 20 000
  propositions. Poste borné, pas de troncature silencieuse des calculs.
  Options réception : 100 derniers documents, historique : 20 derniers calculs.

## Suite vers un MRP complet — ordre de livraison

### M2 — référentiel industriel, unités et sources fiables

Articles communs WMS/Fabrication/CRM ; unités de base et conversions contrôlées ;
BOM Decimal versionnées avec validité, sortie par lot, substitutions approuvées,
pertes et politique Acheter/Fabriquer par site. Ajouter site aux OF/postes et
mapping explicite commandes client/prévisions → demandes, date et unité requises.
Consommation de prévision pour ne pas additionner commande réelle + prévision.

**Acceptation :** un même article n'est jamais dupliqué entre modules ; aucune
conversion implicite ; changement de recette n'altère ni un OF ni un calcul passé.

### M3 — exécution des propositions et achats matières

Créer un vrai parcours fournisseur matière → demande d'achat → commande →
confirmations/ETA → réceptions partielles → solde restant. Le module Procurement
actuel concerne des RFP transport ; ce n'est PAS le modèle d'achat matières.

Conversion contrôlée des propositions MRP vers OF DRAFT / demandes d'achat :
prévisualisation, confirmation humaine, droits cibles, numéros SequencesService,
validation des versions/sources sous verrou, transaction atomique et clé de
conversion durable. Réexécuter le calcul ne doit jamais recréer le même besoin.
Les documents annulés/modifiés/reçus doivent mettre à jour la couverture dérivée.

**Acceptation :** double-clic, double utilisateur, recalcul concurrent et réponse
réseau perdue produisent au plus un document ; jamais de commande externe envoyée
par le calcul ni de stock ajouté avant la réception WMS.

### M4 — boucle MRP ↔ APS PlaniAdvance

Injecter OF et arrivages datés par site dans les snapshots APS. Ajouter quantités
restantes, WIP réel, baseline, gel et décisions opérateur en entrée, sans réinventer
les algorithmes du moteur. Une proposition matière indique pourquoi un OF ne peut
pas démarrer ; l'APS retourne une date faisable qui permet de recalculer le MRP.
Comparer scénarios avant publication via les gates A1/A2 existants.

**Acceptation :** un achat retardé déplace la disponibilité du composant et rend
visible son impact sur les OF/clients ; jamais de stock emprunté à un autre site.
Ne pas présenter l'actuel scheduling respectMaterials agrégé tenant comme cette
intégration site-scopée : ce chemin antérieur reste distinct de M1.

### M5 — exécution atelier et boucle de stock

Réservations de composants, prélèvement, consommation réelle, déclaration de
production, rebut/reprise, encours et clôtures partielles. Tous les mouvements
passent par InventoryService.postMovement, atomiquement avec le document métier.
Coûts théoriques/réels distincts, temps et matières traçables, contrôle qualité.

**Acceptation :** compléter un OF ne crée jamais magiquement un produit fini ;
les quantités consommées, produites et mises au rebut se réconcilient au journal.

### M6 — fabrication de procédés / recettes

Garder le même poste Pulsar, adapter les formulaires et vues au mode produit :
taille de batch min/max, recette proportionnelle/fixe, rendement réel/théorique,
densité et conversion masse/volume contextualisée, coproduits/sous-produits,
lots, généalogie, péremption/FEFO, quarantaine/libération qualité et nettoyage.
Tester procédés continus ou campagnes séparément de l'assemblage discret.

**Acceptation :** une recette de 500 kg peut être planifiée/produite sans arrondir
en « 500 pièces » ; aucune conversion masse-volume sans paramètre validé ; bilan
matière et traçabilité disponibles jusque dans les réceptions/expéditions.

### M7 — pilotage, automatisation et agents

Files d'exceptions métiers, couverture en jours par article, retards imputables,
simulation de demande, coûts d'urgence, rapprochement achats/factures et KPI.
Exposer les lectures MRP via le registre d'outils existant ; conversion/report
d'approvisionnement reste une ProposedAction gouvernée, avec caps, idempotence,
tenant/modules/permissions revérifiés. Aucun « agent qui calcule au jugé » les
besoins, unités ou promesses ; il explique les résultats déterministes.

**Acceptation :** une recommandation permet de retrouver calcul, sources, motif,
approbateur, document produit et résultat opérationnel. Déploiement OVH = bridge
privé non exposé publiquement, migrations versionnées, sauvegardes et observabilité.

## Vérification M1

Dernière passe locale : 662 tests Python (7 benchmarks lents exclus), 646 tests
shared, 279 tests unitaires API dont 5 nouveaux tests de contrat MRP,
24 tests HTTP Fabrication/MRP sur bridge réel, 12 tests UI Fabrication/MRP.
Build et typecheck passent ; 12 avertissements Svelte préexistants hors MRP.
Migration appliquée aux bases locales de développement et test, comparaison
Prisma schéma/BD vide (aucune dérive). Aucun reset ni seed de la base de travail.

Les suites HTTP arrêtent leurs cron jobs après initialisation pour ne pas traiter
les vieux dossiers de la base de test en arrière-plan. Pour la passe bridge réel,
utiliser un sidecar de test séparé du runtime dev (port 18199 par exemple) : les
redémarrages du watcher Nest ne doivent pas interrompre les appels du test.

- Python : explosion multi-niveaux, composants partagés, Decimal, sécurité/MOQ,
  retards, cycles, déterminisme et bridge authentifié sans BD autonome.
- HTTP/PostgreSQL : RBAC et tenant, versions concurrentes, unités, stock par site,
  snapshot immuable/périmé, réception POSTED non doublée, moteur absent/invalide.
  Suite exécutable avec stub, et seconde passe `PULSAR_TEST_REAL_APS=true` sur le
  bridge réel. Les données de test sont dans des tenants dédiés, jamais dans Acme.
- Navigateur : explication et parent, panneau sans déplacement du shell, formulaire
  conservé en erreur, quantités string, lecture seule, vide, mobile et péremption.
- Contrôle local de build/typecheck, sans prétendre que toutes les suites de tous
  les modules métier ont été rejouées ni que cette tranche est prête usine.
