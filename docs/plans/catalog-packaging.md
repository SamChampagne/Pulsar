# Catalogue et Achats — conditionnements I1b

Suite de [I1a](catalog-purchasing-depth.md) et du [programme I](enterprise-information-depth.md).
Ce lot livre les formats physiques des produits et leur usage explicite sur commandes et
réceptions fournisseurs. Il ne clôt pas le programme d’enrichissement des autres modules.

## Parcours utilisateur

1. Dans Catalogue ou Données Achats/Services, ouvrir **Fiche article → Conditionnements**.
   Exemple : code BOX12, libellé Carton de 12, contenu 12 EA, code-barres 001234, colis entiers.
   Les prestations ne proposent pas cet onglet. Catalogue reste facultatif.
2. Dans un brouillon Achats, choisir le format et son nombre, puis **Appliquer le conditionnement**.
   La ligne affiche `2 × Carton de 12 = 24 EA`. Le prix, minimum et multiple fournisseur restent
   par EA : à 2 CAD/EA, le total vaut 48 CAD, pas 4 CAD. Aucune tarification par carton implicite.
3. Enregistrer puis confirmer. Un format modifié/inactif exige une nouvelle sélection; une
   copie engagée reste inchangée après renommage/désactivation du format.
4. Relier explicitement le produit à un article WMS actif de **même unité** dans Stock WMS.
   Achats fonctionne seul; Entrepôt et ses droits ne sont requis que pour la réception physique.
5. Dans Réceptions et reliquats, scanner le code capturé pour retrouver une ligne avec reliquat.
   Le scan est une lecture : aucune quantité ajoutée ni validation. Plusieurs lignes portant le
   même code exigent un choix manuel. Saisir le nombre arrivé, vérifier le calcul, sélectionner
   entrepôt/emplacement et référence, puis confirmer l’arrivée physique.
6. Un carton de 12 reçu crée 12 EA; les pièces d’un carton ouvert peuvent être saisies en unité
   de base en désactivant la saisie par conditionnement. Historique : quantité stock et nombre
   de colis si utilisé. La commande reste ouverte; clôture administrative séparée.

## Contrat et invariants

- `CatalogPackage` : FK composite tenant/article, GOODS seulement, code unique par article,
  code-barres unique dans le registre des conditionnements du tenant. Casse et zéros préservés
  par `normalizeScan`; contrôles embarqués refusés. Un code inactif reste réservé.
- Code, code-barres, contenu et règle entier/fraction sont immuables. Seuls libellé et activation
  sont éditables avec `expectedVersion`. Un changement de contenu exige un nouveau format.
  Pas de suppression, de conversion transitive ou de hiérarchie palette/carton/pièce.
- Writers sous `lockBusinessTenant`, droits read + manage du consommateur et audit `@Audit`.
  Aucun coût d’achat ajouté à Services. Pas de nouveaux droits ni outils agents.
- `packageQuantity` partagé est pur, exact avec BigInt : nombre à 4 décimales, contenu à 6,
  résultat à 4 pour une commande, 3 pour WMS; valeurs positives <= 1 milliard. Non représentable
  à cette précision ⇒ refus, jamais arrondi. Colis entiers contrôlés si configurés.
- Corps ligne : choix optionnel **complet** `packageId`, `packageVersion`, `packageCount`.
  `quantity` existante reste la quantité de base. Le serveur vérifie son égalité exacte au
  produit nombre × contenu; un snapshot fourni par le client est refusé.
- `capturePackage` vérifie tenant, article, activité et version à la sauvegarde ET confirmation.
  La copie JSON serveur `SupplierOrderLine.packageSnapshot` contient identité, contenu, unité,
  code-barres, nombre commandé et quantité de base. Les lignes engagées restent non éditables.
- À réception, le `packageCount` optionnel est contrôlé contre cette copie, **pas le catalogue
  courant**. Pas de réinterprétation après désactivation/renommage. Quantité reçue et solde restent
  dans l’unité WMS 1:1 explicitement reliée; les conversions de nature/unité restent interdites.
- `SupplierReceiptLine.packageCount` est la preuve nullable du nombre reçu; une saisie en pièces
  ne prétend pas connaître un nombre de cartons. Aucune somme de colis entre articles différents.
- Stock via `ReceivingService.postInTransaction` → `InventoryService.postMovement`, mêmes
  verrous business puis tenant WMS, disponibilité et contrôles existants. Stock, document,
  allocation et version commande atomiques. Aucun nouveau writer direct de solde.
- Idempotence : clé liée tenant/acteur/corps; le fingerprint ajoute le nombre canonique seulement
  si fourni. La forme historique sans conditionnement est conservée. Reprise avant vérification
  des versions courantes; même clé/corps ⇒ reçu existant; sens différent ⇒ 409.
- Le navigateur conserve le corps exact avant envoi. Réponse perdue ⇒ reprise explicite de la
  même demande. Une fiche de format incertaine impose une relecture, jamais un POST automatique.

## API

- `GET|POST …/items/:id/packages`, `PATCH …/items/:id/packages/:packageId`, préfixes
  `catalog`, `purchasing/data`, `services/data` : même writer, droits et module du consommateur.
  Liste paginée; recherche code/libellé/code-barres.
- `POST /purchasing/orders/:id/resolve-package` : lecture `purchasing.read`, commande CONFIRMED,
  recherche exacte dans ses copies ayant un reliquat. Zéro match 404, ambiguïté 409; pas de stock.
- Commandes et réceptions conservent leurs endpoints/workflows et contrôles de permissions.
  Anciennes lignes/réceptions sans ces champs restent compatibles; aucun backfill inventé.

## Interface, documentation et limites

Panneau, champs, boutons et sélecteurs Pulsar conservés. Confirmation explicite de conversion,
prix dans l’unité de base visible, états chargement/vide/erreur/reprise, lecture seule et mobile.
Guides intégrés Catalogue/Achats et leurs tutoriels spécifiques enrichis sans nouvelle version
de progression ni bouton tutoriel. Les utilisateurs déjà passés ne sont pas réinitialisés.

USB/Bluetooth clavier et Zebra DataWedge clavier utilisent le champ `ScanInput` existant avec
suffixe Entrée/Tab. Tests logiciels seulement : aucun lecteur physique certifié. Ces codes
ne sont pas enregistrés dans le résolveur global WMS. Pas de GS1 composé, lots, séries, péremption,
impression d’étiquettes, conversion kg/L, prix par carton, grilles/paliers ou réceptions MRP.
La définition du format ne prouve pas le contenu physique : l’opérateur le vérifie.

## Déploiement et recette

Migration additive **120** `20260924090000_catalog_packages` : une table, deux colonnes nullables,
contraintes positives, aucun backfill. Appliquée seulement à `pulsar_enduser_20260921` en local.
`.env` intact, aucun push/PR/déploiement ni envoi externe.

Recette locale du 2026-09-24 :

- Shared : **964 tests** (9 nouveaux cas exacts); API unitaires : **686**; Web : **133**.
- HTTP : **109 tests distincts** sur cinq suites, dont 16 nouveaux pour l’autonomie, isolation,
  RBAC, code-barres, champs immuables, versions/concurrence, capture serveur, précision,
  historique, réception partielle/mixte, doublons, ambiguïtés de scan et mouvements atomiques.
  Régressions : catalogue I1a, coordonnées fournisseurs, connexions métier, autonomie des modules.
- Chromium : **6 parcours distincts** réussis (3 nouveaux, 3 I1a). Création/relecture après
  réponse perdue, modification versionnée, formats relus avant choix, commande et prix de base,
  scan sans saisie implicite, réception partielle et reprise exacte après rechargement,
  lecteur sans écriture et tutoriel au premier accès seulement. Captures desktop/mobile inspectées;
  correction du débordement du fieldset de réception sur mobile. Aucun pageerror observé.
- Svelte : zéro erreur, douze avertissements préexistants dans cinq fichiers.
- Builds Shared/Database/API/Web réussis; `git diff --check` propre. API locale de recette sur
  3100, Web sur 5173. Aucune publication distante.
- Builds Shared/Database/API/Web réussis; `git diff --check` propre. API locale de recette sur
  3100, Web sur 5173. Aucune publication distante.
- Ces tests ne qualifient ni matériel Zebra/USB, ni performance enterprise, ni déploiement OVH.

## Suite

I1 reste ouvert : politique de prix/paliers/dérogations, pièces jointes et imports à qualifier.
Prochain lot recommandé : **I2, informations d’exécution WMS** (stockage, suivi lot/série et
péremption à qualifier avant FEFO/réservations), puis Transport et Fabrication selon la matrice.
Ne pas simplement ajouter des champs lot/péremption sans les porter dans chaque mouvement.
