# Documentation Fabrication — dictionnaire des champs

2 octobre 2026. Référence éditoriale des fonctions présentes, intégrée au dictionnaire
Pulsar existant. Aucun changement métier, DB, moteur, fournisseur ou activation de module.

## Couverture livrée

Neuf sujets, **106 champs et contrôles**. Chaque entrée décrit utilité, type/unité,
obligation/conditions, validation, exemple, effet métier et limites. Une valeur par
défaut n’est donnée que si elle est établie dans le writer ou le formulaire cité.
Ce n’est pas une couverture exhaustive de tous les écrans ni de la fabrication de procédés.

| Sujet (`topic`)                                               | Champs | Lectures minimales / modules                                      |
| ------------------------------------------------------------- | -----: | ----------------------------------------------------------------- |
| `manufacturing-resources` — sites, calendriers, postes        |     12 | Fabrication; manufacturing.read                                   |
| `manufacturing-boms` — nomenclatures, publication et validité |     10 | Fabrication; manufacturing.read                                   |
| `manufacturing-demand` — demandes, prévisions, arrivages      |     10 | Fabrication + WMS; manufacturing.read + wms.read                  |
| `manufacturing-sales-units` — source CRM et ratio exact       |      9 | Fabrication + WMS + CRM; manufacturing.read + wms.read + crm.read |
| `manufacturing-mrp` — politiques, calcul et préparation       |     13 | Fabrication + WMS; manufacturing.read + wms.read                  |
| `manufacturing-purchases` — engagement et réception matière   |     12 | Fabrication + WMS; manufacturing.read + wms.read                  |
| `manufacturing-orders` — OF, gammes et opérations             |     16 | Fabrication; manufacturing.read                                   |
| `manufacturing-shop-floor` — déclaration, lots et correction  |     14 | Fabrication + WMS; manufacturing.read + wms.read                  |
| `manufacturing-aps` — simulation, revue et publication        |     10 | Fabrication; manufacturing.read                                   |

Entrée : `/documentation?view=fields&topic=manufacturing-mrp`, ou recherche dans
Documentation. Le domaine de navigation est `manufacturing`. La recherche et la
liste utilisent le filtrage commun du dictionnaire : domaine visible, toutes les
permissions du sujet et tous ses modules explicites. Aucun compteur de sujets masqués.

## Dépendances : lecture du guide et autorité d’action

Le dictionnaire n’est jamais un octroi de droits. Les contrôleurs/services conservent
leurs permissions au moment de consulter ou modifier un dossier réel.

- Calendriers et postes sont utilisables sans accès aux soldes WMS. Le site est un
  entrepôt du référentiel partagé; il ne devient pas un nouveau stock autonome.
- Lire une BOM/version reste Fabrication seul. Publier ajoute manufacturing.manage,
  wms.read et WMS actif : les SKU/unités actifs sont capturés à ce moment.
- Un OF sans BOM conserve son workflow autonome. Configurer ses matières exige le
  site, une version publiée, une version d’OF fraîche et les droits WMS de lecture.
- MRP, préparations, achats matières et atelier exigent Fabrication + WMS pour leurs
  lectures. Un contexte contenant une source CRM ajoute CRM/crm.read dynamiquement,
  même sur historique. Le guide autonome ne prétend pas pouvoir lire ce contexte.
- Écrire les déclarations/corrections ajoute les droits de gestion des deux modules.
- Un scénario APS sans matières reste Fabrication seul; un artefact avec matières
  exige WMS/wms.read pour lecture, revue, publication et rejeu.

## Distinctions métier rendues explicites

1. Brouillon BOM, version publiée et snapshot d’OF sont trois objets différents.
   Aucune publication ne réécrit les engagements existants.
2. Quantité BOM : positive et neuf décimales au plus; quantité MRP/stock : trois
   décimales; ratio commercial : six décimales. Conversion non exacte refusée.
   Sorties d’OF bonnes/rebutées encore entières, pas de recette fractionnaire simulée.
3. Prévision consommée, demande ferme et arrivage attendu ne sont pas additionnés
   aveuglément. Une réception POSTED est déjà dans WMS; aucun deuxième ajout.
4. Calcul MRP = lecture déterministe. Préparation BUY = demande interne; achat DRAFT
   = document; CONFIRMED = déclaration humaine d’une commande passée hors Pulsar;
   réception POSTED = écriture réelle de stock. Pas d’envoi fournisseur ajouté.
5. Consommation et production sont explicites et atomiques. Le rebut ne crée pas de
   produit fini. Lots/bins exacts; aucun prélèvement implicite ou réservation annoncée.
6. Contrepassation complète = correction d’enregistrement, pas désassemblage physique,
   retour client ou réouverture d’OF terminé. L’original et les preuves restent figés.
7. APS calcule un scénario. Revue et publication recontrôlent moteur, baseline,
   dossiers et matières. Rejeu historique non publiable; pas de forçage des blocages.

## Sources et entretien

Données : `apps/web/src/lib/help/manufacturing-field-reference.ts`.
Contrat UI partagé : `field-reference-types.ts`; agrégation et droits communs dans
`field-reference.ts`. Les sources exactes sont attachées à chaque sujet et visibles
dans la section des contrats utilisés, sans lien vers un fichier privé exposé par API.

Les DTO seuls ne suffisent pas : par exemple quantityPerUnit est facultatif dans
le DTO mais le service fournit 1; la borne effective est un milliard. Les dates et
précisions viennent aussi des services, du code Shared et des formulaires actuels.
Les anciens plans décrivent des états historiques : les mises à jour lots/corrections
et les writers courants priment sur une limite ancienne explicitement remplacée.

Suite éditoriale possible : gammes et qualifications approfondies, formulaires
fournisseur matière, impacts détaillés, autres modules. Les recettes/procédés, batchs,
coproduits, coût de revient et replanification WIP par opération restent des fonctions
à qualifier ou construire, pas des promesses ajoutées par cette documentation.

## Vérification

`manufacturing-field-reference.test.ts` contrôle complétude et unicité, sources/routes
existantes, accès indépendants Fabrication/WMS/CRM, recherche sans accents, enums réelles,
précisions/horizons, séparation calcul/stock/engagement, lots et corrections, publication
APS et défauts non évidents. La validation navigateur du dictionnaire commun appartient
au lot d’intégration; ces tests éditoriaux ne constituent pas une recette usine, ni un
essai du moteur ou d’un fournisseur IA réel.
