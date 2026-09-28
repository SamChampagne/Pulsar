# Catalogue et Achats — profondeur métier I1a

## Périmètre livré

Premier incrément I1 du [programme d’informations métier](enterprise-information-depth.md).
Il enrichit les articles communs et relie les références fournisseurs aux commandes. Il ne
livre pas tous les enrichissements des autres modules ni un moteur complet d’approvisionnement.

### Fiche article

Catalogue → Produits et prestations → **Fiche article**, ou Données → Articles et prestations
dans Achats/Services. Trois accès au même article; aucun module supplémentaire à activer.

- Produit : catégorie, marque, fabricant, référence fabricant, modèle/variante descriptive,
  révision technique, référence externe; longueur/largeur/hauteur en mm, poids net en kg;
  emballage, stockage, manutention et notes internes. Quinze champs facultatifs.
- Prestation : catégorie, révision, référence externe, périmètre, livrables, exclusions et notes
  internes. Sept champs facultatifs, sans dimensions physiques inadaptées.
- Mesures positives, chaînes décimales exactes (9 chiffres entiers / 4 décimales). Elles
  décrivent **une unité du catalogue**, pas une conversion de stock ni une capacité de camion.
- `CatalogItemDetails` : FK composite tenant/article, version entière et `data` fermé, validé
  par `validateCatalogDetails`. Pas de champ arbitraire `stock`, taxe ou règle d’exécution.
- La fiche ne modifie pas `CatalogItem.updatedAt` : son numéro de version protège son contenu
  indépendamment de l’identité de base. Code/type/unité restent immuables.

### Références fournisseur

Depuis Fiche article dans Catalogue ou Achats : onglet **Références fournisseurs**. Les coûts
d’achat ne sont pas exposés par la façade Services ni ajoutés aux résumés d’articles des agents.
Catalogue.read et purchasing.read permettent chacun de consulter ces conditions privées;
les droits manage correspondants et read sont requis pour les écrire.

Une référence courante par article/fournisseur : référence fournisseur, devise CAD/USD/EUR/GBP,
prix unitaire exact, quantité minimale, multiple d’achat, délai indicatif (jours calendaires),
début/fin de validité, description du conditionnement, consignes et activation.

`CatalogSupplierOffer` possède des FK tenant/article et tenant/BusinessPartner. Le fournisseur
doit avoir `isSupplier`; une référence active exige un fournisseur actif. Le fournisseur et
l’article d’un enregistrement ne sont pas déplacés. On modifie ou désactive, on ne supprime pas.
Unicité tenant/article/fournisseur en base, contrôle de version obligatoire (0 à la création).
La désactivation reste possible pour une fiche fournisseur inactive encore marquée fournisseur.

Prix/minimum/multiple portent toujours **l’unité du catalogue**. Par exemple, article EA,
emballage « carton de 3 », multiple `3`, prix `12.3456 CAD/EA` : quantité 6 vaut 74.07 CAD selon
l’arrondi existant du total; quantité 7 est refusée si cette référence est choisie. Aucune
boîte ne devient une pièce automatiquement. Minimum et multiple sont par ligne, non agrégés.

Les dates sont des jours UTC inclusifs, annoncés dans le formulaire. Sans début/fin, la borne
correspondante est ouverte. Le délai ne fixe pas la date attendue de commande; le texte des
conditions ne calcule ni taxe ni échéance de paiement. Aucun envoi fournisseur.

### Engagement de commande

1. Le formulaire affiche la référence correspondant exactement au fournisseur/article choisi.
2. **Appliquer ces conditions** reprend prix et version après une action humaine. La devise
   doit correspondre; aucune conversion de change. Le prix choisi devient non éditable.
3. Le corps contient seulement `supplierOfferId` et `supplierOfferVersion`, pas un snapshot client.
   Le serveur vérifie FK, article/fournisseur, activité, version, dates, prix, devise, MOQ et
   multiple avec `Prisma.Decimal`, sous le verrou business tenant.
4. La copie `SupplierOrderLine.supplierTermsSnapshot` capture les valeurs et la provenance
   lors de l’enregistrement. À CONFIRMED, le serveur revalide les mêmes conditions et leur
   version avant la transition atomique existante. Un brouillon périmé doit resélectionner
   la référence puis être enregistré. Un changement de fournisseur/article ne remappe rien.
5. Après confirmation, les writers existants interdisent l’édition des lignes. Changer ou
   désactiver la référence ne réécrit pas la copie engagée; les lectures montrent la copie,
   sans reconstruire l’historique avec le tarif courant.

**Passer en prix manuel** retire explicitement le choix côté UI et garde le prix à revoir.
Les lignes API sans identifiant/version restent manuelles pour compatibilité. Les conditions
choisies ne sont donc pas une politique globale obligeant l’usage des tarifs ni un contrôle
d’approbation des dérogations. Une saisie manuelle ne fabrique pas un historique fournisseur.
Les anciens brouillons sans référence restent confirmables. Aucun backfill.

## API, isolation et reprise

- `GET|PUT /catalog/items/:id/details`, `/purchasing/data/items/:id/details`,
  `/services/data/items/:id/details` : droit du consommateur, même writer.
- `GET|PUT /catalog/items/:id/supplier-offers` et variante `/purchasing/data/items` :
  listes paginées, filtre supplierId/recherche; DTO concret fermé.
- `GET …/supplier-offers/suppliers` : sélecteur paginé des fournisseurs actifs du tenant.
- Tous les writers prennent `lockBusinessTenant`, partagé avec identité et commandes.
  Création/édition concurrente : une seule version gagne; l’autre reçoit 409.
- Mutations master-data auditées via `@Audit`; transitions de commande via le service existant.
- Après réponse incertaine ou conflit : relecture, pas de renvoi automatique. Le panneau
  désactive l’enregistrement, puis remplace la saisie locale par la version réellement sauvée.
- Aucun nouveau pouvoir agent, projection portail publique, PDF ou connecteur.

## UX et pédagogie

Composants Pulsar conservés : panneau, sections selon produit/prestation, sélecteur fournisseur,
messages vide/chargement/erreur, lecture seule, champs limités et disposition mobile.
Les conditions apparaissent sur la ligne d’achat; elles ne se cachent pas dans une note globale.
Documentation intégrée Catalogue/Achats enrichie. Tutoriel Catalogue spécifique (3 étapes)
et étapes Achats adaptées (7 conservées). Aucun reset de la progression par utilisateur et
aucun nouveau bouton de lancement de tutoriel.

## Suite I1b et restant ouvert

- Conditionnements structurés multiples, codes-barres propres, contenu exact, capture et
  réception désormais livrés dans [I1b](catalog-packaging.md). Prix et stock restent en unité
  de base. Ne pas confondre le libellé de variante avec un vrai article et son stock distinct.
- Grilles tarifaires datées multiples, paliers de prix, dérogations/approbations et politique
  tenant; le présent lot garde seulement une référence courante par couple fournisseur/article.
- Notices via DocumentsService, imports et recherche sur les nouvelles caractéristiques.
- Retours fournisseurs, rapprochement factures et fiscalité restent des workflows distincts.
- WMS, produits CRM et achats matières MRP restent des modèles distincts. Le lien WMS
  explicite de même unité continue d’utiliser les contrôles existants. Aucune création de
  stock ou d’arrivage MRP par la fiche ou sa référence.

## Déploiement et preuves

Migration additive **119** `20260924080000_catalog_purchasing_details` : deux nouvelles tables
et une colonne nullable de copie sur les lignes; rien n’est reconstruit dans le passé.
Appliquée seulement à `pulsar_enduser_20260921` locale. `.env` intact; aucun push/PR/OVH/email réel.
Recette du 2026-09-24 :

- Shared : 955 tests dont 10 du contrat de fiche; API unitaires : 686; Web : 132.
- HTTP : 93 tests distincts, dont 18 nouveaux (tenants, RBAC, autonomie Achats, DTO fermés,
  concurrence, captures serveur, MOQ/multiples entiers et fractionnaires, prix/devise,
  expiration, historique et compatibilité manuelle) et 75 régressions sur autonomie,
  connexions métier et coordonnées fournisseur.
- Chromium : 5 parcours réussis (3 nouveaux et 2 régressions). Enregistrement/relecture après
  réponse perdue, création de référence, commande avec multiple incorrect puis confirmation,
  lecteur sans écriture, tutoriel initial et non-relancement. Captures desktop/mobile inspectées.
- Builds Shared/Database/API/Web réussis; Svelte zéro erreur et 12 avertissements préexistants
  dans 5 fichiers. `git diff --check` propre.

Les tests utilisent des entreprises de recette isolées, sans modifier la progression tutoriel
des comptes réels. Ces preuves ne couvrent ni charge enterprise ni déploiement OVH.
