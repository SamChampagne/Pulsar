# WMS — lots et dates déclarées I2a

> Extension livrée : [I2f — quarantaine et libération documentée](./wms-lot-quarantine.md).
> Les exclusions « sans quarantaine » ci-dessous décrivent le périmètre initial I2a.

## Périmètre

Premier incrément I2, pas clôture du programme enterprise. Le bureau et les composants Pulsar
sont conservés. Parcours couvert : Articles → Lots → réception WMS ou Achats → rangement →
préparation → journal. WMS fonctionne seul; Achats est un consommateur facultatif.

`lotTracked` se choisit explicitement à la création d’un article, puis reste immuable. Les
articles existants restent non suivis, sans backfill de lots ou de dates. Les formulaires de
création rapide Fabrication gardent leur comportement sans lot. Ne pas convertir implicitement
les historiques ni activer le suivi sur un article déjà utilisé.

## Modèle et écritures

- `WmsLot` : identité tenant/article/code unique, numéro fournisseur facultatif, dates civiles
  de fabrication et péremption. Immuable après création, sans endpoint de modification/suppression.
  Dates ISO réelles; péremption >= fabrication. Création sans effet de stock, auditée.
- `WmsLotBalance` : tenant/article/lot/emplacement et quantité exacte à trois décimales.
  FK composites, unicité tenant/lot/bin et contrainte SQL non négative.
- `ReceiptLine`, `PickLine`, `StockMovement` portent `lotId` facultatif avec FK composite
  tenant/article/lot. Un article suivi l’exige; un article non suivi le refuse.
- Tous les soldes restent écrits exclusivement par `InventoryService.postMovement` : mutex
  tenant, relecture, contrôle disponibilité par lot, solde lot + `InventoryLevel` total +
  journal dans la même transaction. Aucun emprunt au solde d’un autre lot.
- Les mouvements générés par un parcours non équipé échouent avant stock/journal. La
  transaction appelante annule aussi le document ou sa transition.

Réceptions et préparations gardent leurs versions/state machines. Readiness groupe les
quantités par article/emplacement/lot, ne réserve rien. Les anciennes lignes restent NULL.
Une même réception/préparation peut comporter plusieurs lignes de lots distincts. La page
Achats propose un seul lot par ligne d’arrivage; utiliser plusieurs arrivages si nécessaire.

## Reprise et droits

MOVE et réception fournisseur conservent leur operationKey et ajoutent le lot à l’empreinte
uniquement s’il est fourni : anciens replays identiques. Relecture du replay avant disponibilité.
Même clé avec un autre lot ⇒ 409. Les demandes conservées par le navigateur incluent le lot.
Création de lot après résultat incertain ⇒ relecture, pas de retry automatique.
Depuis [I2b](wms-lot-counts.md), les nouveaux ajustements du navigateur utilisent aussi une
clé durable conservant quantité signée/lot/acteur. Les clients historiques sans clé restent
compatibles mais sans dédoublonnage garanti.

Tous les endpoints lots exigent WMS + wms.read; création exige aussi wms.manage. Tenant issu
du JWT, article/bin/lot vérifiés. Les preuves d’arrivage restent lisibles par Achats sans
exposer les soldes courants du WMS. Aucun outil mutating agent ajouté.

## Interfaces et explication intégrée

`/wms/items/:id/lots` : recherche paginée, identité/dates, total par lot de cet article sur
tous les entrepôts, lien vers le journal ciblé. La quantité est un stock physique, pas un ATP.
Sélecteur de sortie filtré sur les lots positifs du bin source. Nouveau lot ouvrable depuis
une réception, puis actualisation explicite; aucun choix automatique du premier lot.
Journal et dossiers affichent numéro/péremption. Documentation WMS/Achats et tutoriel WMS
spécialisé enrichis, mécanisme premier passage par utilisateur inchangé, aucun bouton tutoriel ajouté.

## Limites assumées et suite

Dates déclaratives seulement : aucun blocage de péremption, FEFO, quarantaine, réservation,
certification, rappel, généalogie transitive/allocation par pièce ou décodage GS1. Aucun numéro de série.
Depuis I2b, le comptage sépare les lots et refuse les instantanés périmés. Consommation/retour
Services choisit et capture désormais le lot puis le conserve au retour ([I2c](services-part-lots.md));
les déclarations atelier choisissent désormais leurs lots et capturent une généalogie directe
([I2d](manufacturing-lots.md)). Le MRP lit les totaux physiques, sans allocation de lot
ni soustraction de stock périmé. N’activer ce pilote que sur les parcours équipés.

Comptage par lot et reprise durable des ajustements livrés dans I2b, pièces Services dans I2c,
atelier et généalogie directe dans I2d. Suite : corrections compensatoires puis qualifier
quarantaine/FEFO et enfin numéros de série avec unicité par pièce. Correction contrôlée de
dates/identité à concevoir avant généralisation; pas d’édition silencieuse de la preuve.

Migration `20260924100000_wms_lots` (121), testée uniquement sur la base locale isolée.
Tests : `apps/api/test/wms-lots.e2e-spec.ts`, `apps/web/e2e/wms-lots.spec.ts` et régressions
WMS/Achats. Résultats de vérification consignés dans `docs/etat-du-projet.md`.
