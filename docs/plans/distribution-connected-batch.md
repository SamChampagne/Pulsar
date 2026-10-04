# Distribution connectée — batch local du 3 octobre 2026

Les cinq axes sont autorisés, sans VPS, fournisseur réel, commit ou publication implicite.
Ce document suit la réalisation; une ligne ouverte n'est pas une fonctionnalité livrée.

## Ordre et preuves

- [x] Chauffeur : document externe fermé et canonique; incidents à traiter, tentative, retour autorisé et réception physique explicite.
- [x] Lignes : sources commerciales/préparation choisies explicitement, couverture exacte par unité et sans double stock. Transport seul reste autonome.
- [x] Carburant : profils véhicule, prix datés choisis, paramètres capturés, comparaison déclaré/estimé avec devise et baseline explicites.
- [x] Exploitation : poste des dossiers à traiter, blocages/prochaine action, contexte IA en lecture et propositions via la gouvernance existante.
- [x] Recette locale : migrations sur base jetable, tests purs/API/HTTP/UI, rôle limité et deux tenants, concurrence/réponse perdue, aide et documentation exactes.

## Où utiliser ce lot

- Transport → **Exploitation livraisons** (`/delivery-operations`) : filtres, incidents,
  prochaine action et brouillon d’analyse dans l’espace IA, sans envoi automatique.
- Fiche chargement : **Sources**, **Chauffeur**, **Incidents et retours**;
  paramètres carburant dans le panneau itinéraire. La création de documents et
  toute décision opérationnelle restent explicites et soumises aux droits.
- Poste chauffeur mobile : document partageable, instruction de tentative/retour,
  signalement dont « Destinataire absent ». Le retour reçu reste une attestation
  humaine interne, jamais une action accessible par le lien public.
- Documentation → **Champs détaillés** : cinq guides supplémentaires, 54 champs;
  total du dictionnaire : 30 sujets / 332 champs et contrôles. Cette couverture
  ne constitue pas une documentation exhaustive de tous les modules Pulsar.

## Contrats détaillés

- [Documents chauffeur](distribution-driver-documents.md)
- [Allocations commande/préparation vers colis](distribution-allocations.md)
- [Incidents, retours et assistance IA](distribution-exceptions-ai.md)
- [Carburant opérationnel](delivery-fuel-operations.md)
- [Poste exploitation](distribution-operations.md)

## Preuves exécutées le 3 octobre 2026

- Shared : 1 271 tests / 138 fichiers. API : 1 100 tests / 133 suites.
- Web : 305 tests / 45 fichiers.
- HTTP sur PostgreSQL jetable : 98 cas distincts / 9 suites (97 dans le passage
  groupé puis 12/12 allocations avec le cas JSONB supplémentaire). Isolation,
  modules/droits, concurrence, clés de reprise et gardes SQL effectivement testées.
- Chromium avec API simulée : 85 parcours distribution et 18 documentation.
  Les 8 incidents ont été repassés après correction du contrat réel de recherche
  des lieux; les 14 parcours chauffeur après ajout de l’option absence.
- Types API/Web et builds API/Web réussis. Douze avertissements Svelte préexistants
  restent présents dans d’autres écrans; ils ne sont pas masqués.
- Deux migrations appliquées : `20261003120000_distribution_connected` et
  `20261003120500_delivery_return_execution`. Prisma généré, shared/database rebâtis.
- Captures mobiles et PDF multi-pages inspectés. Serveur Web de recette et
  PostgreSQL jetable arrêtés après les tests; aucun `.env` ou lockfile modifié.

La recette navigateur simulée ne prouve pas un parcours avec fournisseur réel.
Une recette humaine de bout en bout et le pilote terrain restent à réaliser.

## Suite avant publication du grand batch

1. Rejouer une tournée complète avec une entreprise dédiée : départ, livraison
   partielle, absence, nouvelle tentative, retour autorisé/reçu et clôture; vérifier
   que le stock et la facturation n’ont aucun effet implicite.
2. Vérifier les PDF et rôles d’exploitation avec l’utilisateur, puis qualifier
   volontairement un worker PROPOSE avec compte connecté, budget et approbateur.
3. Faire une revue consolidée de toute la branche, préparer une seule PR lorsque
   demandée et la recette de migration/sauvegarde. Le VPS reste inchangé jusque-là.

## Frontières

Un retour reçu atteste une garde physique, jamais une entrée WMS, un remboursement
ou la livraison de la commande. Les quantités de stock sont celles des mouvements
WMS existants. Les sources de lignes sont explicites : aucun matching par SKU/nom
ou conversion implicite. Le carburant estimé reste distinct de la surcharge client
et d'une dépense comptabilisée. Une comparaison ne réécrit jamais un coût clôturé.

Les documents internes historiques restent privés. Une nouvelle édition partageable
doit être revue, figée et autorisée au moment du téléchargement. Les essais IA
simulent les outils sans compte fournisseur : ni qualité du modèle ni VPS qualifiés.

Pas de solveur multi-camions, douane, certification poids lourds, file mobile hors
ligne complète ou qualification Zebra matérielle annoncés par ce batch.
