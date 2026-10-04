# Distribution — attributions facultatives de contenu

## Ce qui est relié

Dans une fiche chargement, **De la commande à la livraison** rapproche une ligne
entière de contenu d’un colis avec une ligne commerciale CRM, une ligne de
préparation WMS terminée, ou les deux. La sélection est humaine et explicite.
Une référence ou un SKU identique ne crée jamais de rapprochement automatique.
Transport seul reste autonome : ni CRM, ni WMS ne devient une dépendance obligatoire.

1. Déclarer le contenu du colis et choisir l’expédition.
2. Sélectionner « Relier la ligne ». La quantité attribuée est la quantité entière
   affichée, sans arrondi. Pour une quantité partielle, corriger d’abord les lignes
   du colis préparé; il n’existe pas de fractionnement caché dans le rapprochement.
3. Choisir la commande source et/ou la préparation source.
4. Vérifier la correspondance métier et confirmer. Une seule attribution active
   existe pour cette ligne de contenu. Le colis avance de version.
5. Avant tout chargement physique, un lien peut être libéré explicitement. Il
   reste dans l’historique. Après le premier événement de chargement, il est figé,
   même si le colis est retiré du camion avant transit.

## Conditions et unités

- La ligne CRM appartient à la commande **CONFIRMED** à l’origine de l’ordre de
  transport (`sourceSalesOrderId`); aucune recherche globale de commandes libres.
- Le CRM ne possède pas d’unité native sur `SalesOrderLineItem`. Un humain actif
  doit donc attester explicitement qu’**une unité commerciale = une unité du
  contenu du colis**. Cette attestation, l’acteur, la quantité et les versions sont
  capturés. Aucun ratio de conversion ni inférence depuis un produit ne s’applique.
- La préparation WMS est **COMPLETED**, liée à cette expédition et à son entrepôt
  de départ. Son unité est identique, caractère pour caractère, à celle du contenu.
  Les lignes OPEN/PICKED ne prouvent pas une sortie de stock et ne sont pas proposées.
- Choisir les deux sources atteste leur correspondance; ni nom, ni SKU ne la
  remplace. Une préparation déjà liée à une autre expédition ne peut être utilisée.
- Quantités exactes positives, 12 chiffres entiers et 3 décimales maximum. Les
  quantités hors contrat sont refusées, jamais arrondies.

## Compteurs

Le poste présente les quantités **par ligne source** et **par unité**, sans total
général qui mélangerait pièces, kilogrammes ou références différentes. La ligne
commerciale couvre toutes ses expéditions; la ligne de préparation précise son site.

- Commandé : quantité commerciale source (équivalence 1:1 signalée).
- Préparé : quantité de la ligne de préparation terminée, pas quantité réservée.
- Emballé attribué : attributions non libérées, y compris colis chargés, livrés,
  retournés et éventuelles traces annulées conservatrices.
- Livré net : seulement les colis actuellement DELIVERED.
- Retourné : colis RETURNED, distinct de la livraison nette.
- À attribuer : source moins les attributions actives.
- Non livré net : source moins le livré net; ce n’est pas une instruction de remplacement.

Un retour conserve sa capacité d’attribution historique. Il ne rend pas une ligne
commerciale ou une ancienne préparation réutilisable silencieusement : les
remplacements et leur réautorisation commerciale restent une extension à concevoir.
Le total d’attributions est contrôlé globalement par ligne commerciale et par ligne
de préparation, pas seulement dans le chargement affiché.

## Droits, reprise et invariants

Base `/api/v1/transportation/delivery-allocation`, Transport activé :

- GET `?shipmentId=` : `transportation.planning.read`.
- POST : `transportation.planning.manage`, UUIDv4 `operationKey`, packageId,
  contentIndex (0..49), expectedVersion, sourceSalesOrderLineId et/ou sourcePickLineId.
  CRM ajoute salesUnitAcknowledged=true et les versions ligne/commande attendues;
  WMS ajoute expectedPickUpdatedAt.
- POST `/:id/release` : même droit, operationKey et expectedVersion.

CRM/WMS doivent être activés **et** leurs droits de lecture présents avant toute
requête vers leurs sources. Un lien combiné exige les deux droits pour en lire les
détails ou le libérer. Les indices verrouillés restent visibles sans divulguer la
source privée. Aucun endpoint public ni nouvel outil agent de mutation n’est ajouté.

Ordre des verrous : opération → business tenant → ligne tenant WMS → chargement →
expédition. Sources et versions relues, capacité contrôlée, attribution/reçu/audit
et versions parentes écrits dans la même transaction. L’opération est idempotente
sur tenant/UUID normalisé; empreinte liée à acteur, cible et corps. Rejouer retourne
le reçu original, sans revalider une ancienne action contre un nouvel état métier.
Les droits source restent requis pour le rejeu.

L’interface conserve seulement l’intention minimale par tenant/utilisateur/chargement
dans sessionStorage, avant envoi. Après perte de réponse, conflit ou perte d’accès,
elle n’envoie rien automatiquement : inspecter puis reprendre exactement la demande.
Un reçu incomplet ne fait pas oublier l’intention. Fermer le navigateur peut perdre
cette sauvegarde; il ne s’agit pas d’une file de travail hors ligne.

Snapshots source et contenu immuables; libération en paire date/acteur affectée une
seule fois; journal d’opérations append-only; FKs composites tenant/package/sources.
Éditer le contenu ou annuler un colis avec attribution active exige sa libération
préalable; un simple libellé de colis peut rester modifiable selon le workflow D1.

## Aucun double stock ni double comptabilité

La préparation WMS a déjà produit sa sortie via `InventoryService.postMovement`.
Attribuer, charger, livrer ou retourner ne répète pas ce mouvement. Un retour reçu
ne crée ni réception WMS, ni avoir, ni remboursement. Aucun coût figé n’est recalculé.
Ces liens n’ajoutent ni réservation WMS, ni lots commerciaux, ni facture automatique.

Limites explicites : 200 colis par expédition, 500 lignes par famille de sources,
10 000 attributions pour la lecture d’un périmètre. Dépassement refusé avec message,
jamais tronqué silencieusement. Sources commerciales dans une seule unité attestée;
pas de multi-ratio ni réallocation après engagement dans ce lot.

## Vérification

Tests purs : calcul exact, unités incompatibles, dépassement, libérations, retours.
Unités API : sources explicites, attestation humaine, droits avant lecture, versions,
rejeu et UUID, capacité, historique, autonomie Transport. Chromium simulé : parcours
CRM/WMS, lecture seule, modules absents, conflit, réponse perdue, libération et mobile.
Les résultats exécutés et la recette PostgreSQL figurent dans l’état du projet global.
Aucun VPS, stock utilisateur, compte fournisseur ou scanner physique n’est qualifié.
