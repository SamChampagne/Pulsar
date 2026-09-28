# Sorties documentées WMS — I2i

Extension livrée : [I2j — réception d’achat rattachée et justificatifs protégés](wms-return-purchase-evidence.md).
Les limites ci-dessous décrivent le palier initial; I2j ajoute ces deux parcours sans
changer les invariants de sortie physique ni créer d’avoir fournisseur.

## Parcours livré

WMS → Flux → Sorties documentées (`/wms/stock-exits`), ou Articles → Lots →
Sorties documentées. Une sortie vise exactement un article suivi, un lot, un
emplacement et une quantité positive dans l’unité capturée (au plus 3 décimales).
Créer plusieurs dossiers pour plusieurs lots/emplacements. Le panneau reprend les
composants Pulsar, sans déplacer le shell. Les instants utilisent le fuseau utilisateur.

1. Préparer : destruction/rebut ou retour fournisseur, motif explicite. Le brouillon
   n’est ni réservation, ni ordre d’expédition, ni mouvement de stock.
2. Retour : fournisseur actif du socle, référence d’autorisation et destination
   confirmée explicitement. WMS peut créer cette référence sans activer Achats.
3. Examiner : quantité physique du lot/bin, quantité retirée, reste, disposition
   actuelle et blocages. La revue ne produit aucun effet.
4. Confirmer après l’opération physique, avec compte rendu et case de confirmation.
   POSTED conserve auteur, instant, copies de données et preuve du mouvement.
5. Annuler uniquement un DRAFT avec motif. Son contenu est fixe : annuler/recréer
   pour corriger. POSTED et CANCELLED sont terminaux, jamais remis en stock implicitement.

## Droits, autonomie et données

Toutes les routes exigent WMS actif et `wms.read`. Préparation/annulation exigent
aussi `wms.manage`. Confirmation : `wms.stock.dispose` ou `wms.stock.return` selon
le type, plus un utilisateur interne actif. Les comptes de service et agents sont
refusés, même avec permissions. Aucun outil IA ajouté ni pouvoir automatique accordé.

Au déploiement, appliquer la migration et synchroniser les catalogues avec le
`bootstrap` prévu dans [la recette OVH](../../deploy/ovh/README.md), puis attribuer
explicitement ces droits aux responsables concernés. Ne pas lancer le seed de
démonstration sur le VPS. Aucun déploiement distant réalisé pour cet incrément.

Tenant issu de la session, ownership des FK vérifié. FKs composites tenant sur
article/lot/bin/fournisseur/auteurs/mouvement. Projection publique interne explicite,
sans clés de reprise ni empreintes. Fournisseur partagé, mais aucune lecture ou
activation des dossiers Achats nécessaire. Aucun lien déduit par nom/SKU.

## Atomicité et quarantaine

`StockExitsService` prend le verrou business tenant puis le verrou WMS tenant avant
de relire. Le premier synchronise les writers fournisseurs; le second tous les
mouvements, fiches de lot et décisions de quarantaine. Version du document et hash
de revue revérifiés sous verrou : copie du document, quantité, unité, disposition,
révision et compteur de mouvements du lot. Même un aller-retour à solde égal invalide
une ancienne revue. Article/bin inactifs, unité changée, stock insuffisant ou identité
fournisseur modifiée depuis la préparation bloquent la sortie.

Le mouvement passe exclusivement par `InventoryService.postMovement` : registre,
solde du lot, total article, preuve et fermeture du dossier sont atomiques. Le garde
central réserve les types DISPOSAL/SUPPLIER_RETURN et `refType=stock-exit` aux dossiers
DRAFT dont article, lot, bin, quantité et unité correspondent exactement, sans mouvement
antérieur. Aucun booléen générique de contournement de quarantaine.

La quantité explicitement documentée peut sortir d’un lot en quarantaine; le reste
garde son état et sa révision. Les PICK, consommations, ajustements négatifs et autres
sorties restent bloqués. Aucun autre lot/bin ne comble un manque. Un index SQL partiel
unique `(tenantId, refId)` sur les mouvements stock-exit protège le mouvement unique.

## Reprise et historique

Création : UUID et empreinte tenant/acteur/corps; replay exact retourne le même dossier.
Clôture : UUID unique par tenant, empreinte acteur/id/version/revue/compte rendu.
Le replay exact est résolu avant fraîcheur/stock, mais après droits et utilisateur
actifs. POSTED n’est jamais exécuté une deuxième fois. Autre acteur ou autre contenu
avec la même clé : conflit. Annulation utilise le même principe.

Le navigateur conserve l’intention avant l’appel, séparément par tenant/utilisateur.
Stockage indisponible : aucune requête métier envoyée. Réponse incertaine : reprendre
la même demande. Un refus intermédiaire de reprise n’efface pas la preuve locale.
Une demande illisible bloque la nouvelle saisie; faire inspecter le registre avant
réinitialisation. Pas de file offline multi-appareil ni abandon silencieux.

Le journal pointe au dossier SX; le dossier pointe au lot et au journal. Copie
fournisseur/article/lot/bin à la création; preuve version 1 de la revue à la sortie.
Audit après commit via le service best-effort existant. Aucun backfill des anciens
mouvements. Migration additive `20260925060000_wms_stock_exits`.

## Limites assumées

- Articles suivis par lot seulement; pas de numéros de série, dossier multi-lignes,
  allocation unitaire, fractionnement de quarantaine ou réservation physique.
- Destination et compte rendu déclaratifs : pas de pièce jointe, signature, certificat
  de destruction réglementaire ni preuve de réception du fournisseur dans cette version.
- Aucun achat original rapproché implicitement, avoir fournisseur, remboursement,
  remplacement, facture, transport, email ou intégration comptable.
- Une sortie réelle n’est pas la correction d’une déclaration atelier. Les corrections
  atelier conservent leur workflow dédié et leurs garde-fous.
- Après erreur dans un POSTED, ne pas compenser à l’aveugle : inspecter les preuves et
  définir un dossier correctif séparé avant toute nouvelle opération physique.

## Documentation et recette

L’aide de page et Documentation expliquent règles, droits, connexions et limites.
Tutoriel WMS étendu à huit étapes avec exploration des Sorties documentées; progression
existante conservée, pas de nouveau bouton ni nouvelle présentation forcée.

Tests HTTP : sortie partielle en quarantaine, copies et journal, replay concurrent,
conflits acteur/corps, annulation, droits/modules/tenants, WMS seul, fournisseur changé,
revue périmée à solde égal, pas de transfert implicite entre bins/lots, concurrence de
dossiers et rollback après écriture de mouvement. Tests partagés : workflow fermé.
Tests navigateur : préparation, confirmation, reprise exacte, lecture, aide et mobile.

Recette locale du 2026-09-25 : 260 tests HTTP sur 14 suites, 978 Shared,
691 unitaires API et 156 Web réussis; 18 tests Web ciblés rejoués après les derniers
textes. 43 scénarios Chromium réussis, dont réponse de sortie perdue puis refus
intermédiaire et reprise exacte; retour fournisseur, annulation et droits distincts.
Builds Shared/Database/API/Web réussis; Svelte zéro erreur, douze warnings préexistants.
Migration 127 appliquée uniquement à `pulsar_enduser_20260921`; `.env` inchangé.
