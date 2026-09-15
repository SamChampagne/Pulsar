# MRP M2.1 — référentiel industriel versionné

Livraison locale du 2026-09-15. Suite de M1; ce lot ne termine pas M2 ni le MRP complet.
Le bureau et le langage visuel Pulsar sont conservés. Aucun code du projet
PlaniAdvance original n'est modifié.

## Parcours disponible

1. Créer les articles WMS avec leur SKU et unité de base.
2. Préparer `/manufacturing/boms` : produit = SKU WMS exact; chaque composant est
   exprimé dans son unité WMS pour **une unité** du produit. Enregistrer l'en-tête
   avant de modifier les lignes. L'éditeur utilise le panneau latéral Pulsar.
3. Vérifier les unités affichées, confirmer puis publier. La publication capture
   SKU, nom, unité, quantités Decimal et empreinte. Elle n'active aucune règle MRP
   et ne modifie aucun OF. Le même contenu republié rend la même dernière version.
4. Dans les règles MRP, choisir explicitement la version publiée pour Fabriquer.
   Un nouveau brouillon ou une v2 publiée ne modifie jamais une règle attachée à v1.
5. Sur un OF brouillon, « Configurer les matières » associe site et version du même
   SKU produit. À la libération, un instantané capture les besoins totaux exacts.
   Les changements ultérieurs de nomenclature n'affectent plus cet OF.

## Contrats

- `Bom`/`BomLine` sont le brouillon; `BomRevision`/`BomRevisionLine` des artefacts
  append-only par les services (aucun endpoint d'édition/suppression de version;
  pas de prétention à une protection contre un administrateur SQL).
- POST `/manufacturing/boms/:id/revisions` exige manufacturing.manage + wms.read,
  Fabrication/WMS actifs, `expectedUpdatedAt` et `acknowledgeUnits: true`.
  GET de version exige manufacturing.read, tenant-scopé; ces données publiées
  n'exposent aucun solde WMS. Maximum 500 lignes, 30 versions récentes dans l'UI;
  une ancienne version reste lisible directement par son identifiant.
- Tous les writers de brouillon prennent le verrou de ligne du tenant partagé
  avec WMS/MRP. PATCH/POST de ligne exigent la version du parent; DELETE transmet
  `expectedUpdatedAt` en query. Version manquante/périmée = 409. Chaque édition de
  ligne avance la version du parent. Quantité = chaîne décimale positive, au plus
  1 milliard et 9 décimales; les anciens nombres JSON finis restent acceptés.
- Le produit et tous les composants sont résolus en articles actifs du tenant
  à la publication; unité non vide, auto-composant direct interdit. Le moteur MRP
  continue de refuser les cycles multi-niveaux. Une BOM utilisée est désactivée,
  jamais supprimée. Une désactivation empêche les nouveaux rattachements, elle
  n'efface pas les versions déjà choisies dans des dossiers existants.
- SKU/unité WMS deviennent immuables après utilisation (stock, documents WMS,
  politiques/entrées MRP, nomenclatures ou OF), vérification sous verrou partagé.
  Nom et paramètres descriptifs restent modifiables. Aucune conversion implicite.
- `MrpItemPolicy.bomRevisionId` est obligatoire pour MAKE, interdit pour BUY.
  Le calcul suit les IDs/articles et unités capturés dans cette version.
  `MrpRun.sourceMetadata` conserve les IDs/numéros/empreintes de versions; la
  fraîcheur inclut cette provenance, sans changer le bridge privé MRP v1.
- POST `/manufacturing/orders/:id/material-context` exige manufacturing.manage
  + wms.read, WMS actif, site entrepôt actif, version et `expectedUpdatedAt`.
  FK vérifiées par OwnershipService et revalidation transactionnelle. Seul un
  DRAFT sans instantané peut modifier le contexte. Une fois lié, SKU et BOM ne
  changent plus via le PATCH général; quantité encore éditable avant libération.
- Libération : state machine + claim conditionnel état/version, capture et statut
  dans la même transaction. Quantité/site/version/matières sont ensuite figés.
  Les besoins sont exacts en Decimal; quantité de l'OF reste entière dans ce lot.
  Aucun mouvement, réservation ou document d'achat n'est créé.
- APS avec matières : lecture de l'instantané de l'OF, **jamais du brouillon**;
  stock des bins actifs du site capturé. Les OF matières de plusieurs sites dans
  le même calcul sont refusés jusqu'à M4. Le ledger APS existant reste numérique
  (number/float), contrairement au MRP Decimal : ce n'est pas un journal de stock.

## Migration et compatibilité

Migration `20260915190000_manufacturing_definitions` : Decimal(24,9), tables de
versions, liens MRP/OF et instantané JSON. Aucun seed/reset ni backfill historique.
Les Float non finis ou demandant un arrondi sont refusés par le précontrôle SQL.

Les anciennes règles MAKE doivent publier puis sélectionner une version avant
le prochain calcul. Les anciens calculs restent lisibles; leur empreinte de
fraîcheur M1 peut les marquer à recalculer. Un ancien OF libéré ne reçoit aucune
version inventée. La planification avec matières refuse un OF BOM sans instantané;
la planification APS ordinaire reste disponible. Un OF DRAFT avec BOM exige site
et version avant sa libération; un OF sans BOM garde le workflow sans matières.

Les nouveaux clients doivent envoyer les versions sur les writers BOM/contexte OF.
Après réponse incertaine, inspecter le brouillon/historique avant réessai; les lignes
de brouillon ne disposent pas encore d'une clé d'opération durable. Aucun retry
automatique n'est ajouté. La publication répétée du même contenu est idempotente.

## Validation

- Migration appliquée sur les bases locales de test et de développement; diff
  Prisma vide sur la base de test après application. Aucun reset ni reseed.
- 27 tests HTTP ciblés PostgreSQL avec le vrai bridge PlaniAdvance : versions/Decimal,
  concurrence, tenant/RBAC, fraîcheur MRP, unités figées, capture OF et absence
  de mouvements de stock.
- 283 tests unitaires API passent, dont les gardes APS : stock limité au site,
  refus multi-site/historique, unités.
- 18 tests navigateur ciblés : nomenclatures, contexte OF, MRP et revue APS;
  panneaux, droits lecture seule, conflits, chaînes décimales, écrans étroits.
- Build complet et typecheck web validés; 12 warnings Svelte préexistants hors lot.

## Suite

M2.2 : conversions d'unités contrôlées, sites des postes/calendriers, validité des
versions et sources commandes/prévisions avec consommation de prévision. M3 :
achats matières puis conversion idempotente des propositions vers achats/OF, avec
prévisualisation et confirmation. Les recettes/batchs, rendements, coproduits,
généalogie, exécution atelier et coûts restent dans M5/M6. Ne pas présenter M2.1
comme une couverture procédés complète ni une fermeture de boucle MRP–APS.
