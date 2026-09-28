# Fabrication — lots atelier et généalogie directe I2d

> Complété par [I2e — corrections compensatoires](manufacturing-reversals.md) :
> contrepassation complète de preuves v2 sur OF en cours, sans modifier l’original.

> Complété par [I2e — corrections compensatoires](manufacturing-reversals.md) :
> contrepassation complète de preuves v2 sur OF en cours, sans modifier l’original.

25 septembre 2026 · `codex/pilot-business-depth`.
Complète la [boucle opérationnelle](manufacturing-operational-loop.md) et les [lots WMS](wms-lots.md).

## Parcours utilisateur

OF avec site et version matières figés → libérer → démarrer → **Atelier et stock réel**.
L’opérateur saisit quantités bonnes/rebutées, destination, note et consommations réelles.
Chaque ligne positive d’article suivi exige un lot explicite. **Ajouter un lot / emplacement**
répartit un composant entre plusieurs sources, jusqu’à 200 lignes. Chacune garde sa quantité
en unité WMS; aucun prélèvement dans un lot voisin, aucune conversion implicite.

Un seul lot produit par déclaration, choisi si les bons produits sont suivis. Plusieurs lots
finis ⇒ déclarations distinctes. Créer une fiche de lot ouvre le registre WMS, sans fabriquer
de stock. Revenir puis actualiser les lots et choisir explicitement la fiche voulue.
Les quantités bonnes et rebutées sont encore des entiers; consommations à trois décimales.

Zéro de consommation explicite est permis mais ne porte pas de lot ni mouvement. Une déclaration
uniquement rebutée ne porte pas de lot produit et n’ajoute aucun stock. La destination et les bins
restent validés sur le site même dans ce cas, conformément au contrat atelier historique.

## Preuve et interrelations

La déclaration capture `evidence.version = 2`. Chaque mouvement contient ses identifiants,
article/SKU/nom, unité, quantité, code du bin et copie immuable du lot (ID/numéro/fournisseur/
dates civiles). Les mouvements WMS gardent leurs FK tenant/article/lot existantes.
L’UI montre **Matières consommées → Production bonne**, puis le journal filtré par déclaration
et, pour chaque lot, les mouvements de cette déclaration. Le journal WMS peut remonter à l’OF.

Il s’agit d’une **généalogie directe au niveau de la déclaration** : les entrées enregistrées
dans cette même opération sont reliées à sa sortie, sans répartir les composants entre bonnes
pièces et rebuts. Une consommation d’une déclaration antérieure n’est pas attribuée automatiquement
à une production ultérieure. Une déclaration sans consommation explique cette absence de lien.
Les preuves v1 restent lisibles avec avertissement; aucune reconstitution depuis les lots courants.

MRP capture les preuves sans recompter le stock produit (déjà dans WMS). Les impacts matières
additionnent toutes les lignes d’un composant, y compris plusieurs lots. APS et ses restrictions
sur WIP restent inchangés; aucun nouveau pouvoir agent ni mouvement déclenché par un calcul.

## Contrat technique

- POST `manufacturing/shop-floor/orders/:id/declarations` : `outputLotId?` et
  `consumptions[].lotId?`; null/vide/non-string refusés. Lot obligatoire/interdit selon
  l’article, vérifié par `assertLot` sous le verrou tenant WMS. Lot sur quantité nulle refusé.
- Même transaction pour déclaration, CONSUMPTION/PRODUCTION, soldes total/par lot, preuve
  et version de l’OF. Manque sur une ligne ⇒ rollback complet. Pas de modification de BOM,
  snapshot matières, statut ou coût par ce nouveau choix.
- Fingerprint canonique existant : les payloads historiques sans nouveaux champs restent
  inchangés. Même clé avec autre lot/corps/acteur ⇒ 409. Replay exact avant version/statut,
  mais activation et droits toujours contrôlés. Pas de suppression de déclaration.
- Lecture atelier : Fabrication + WMS, manufacturing.read + wms.read. Écriture : aussi
  manufacturing.manage + wms.manage. Aucun module Services/Catalogue/Achats/Transport requis.
- Journal WMS : source OF projetée seulement si Fabrication activée ET manufacturing.read.
  Résolution bornée à la page de mouvements, par tenant et propriété de l’OF. Pas de
  snapshot matière ni détail de déclaration révélé au simple lecteur WMS.
- Aucun nouveau schéma/table/migration : extension de la preuve JSON immutable existante,
  et des lots déjà référencés par les mouvements. Aucun backfill historique.

## Reprise, interface et aide

Intention conservée avant envoi par tenant/utilisateur/OF, contenant lots et quantités exacts.
Après réponse incertaine, reprendre la même déclaration, même après reload ou un refus
intermédiaire. Un refus de reprise conserve l’intention. Une nouvelle demande définitivement
refusée garde la saisie et exige une actualisation. Une intention corrompue bloque l’envoi;
faire vérifier le journal avant toute réinitialisation. Aucun mode hors ligne complet.

Les composants, panneau et typographie Pulsar sont conservés. Sélecteurs et erreurs existants
réutilisés; confirmations retirées quand les choix changent; preuve en deux colonnes sur bureau,
une sur mobile. Dates d’événements dans le fuseau utilisateur; dates de lots civiles inchangées.
Documentation Fabrication/WMS et connexion métier enrichies. Cinq étapes de tutoriel spécifiques,
première visite par utilisateur seulement; aucun nouveau bouton ni remise à zéro des parcours.

## Recette locale

- **226 tests HTTP, treize suites** : WMS, Fabrication/MRP, achats, services et connexions.
  Les scénarios atelier vérifient notamment multi-lots, stock insuffisant avec rollback,
  mauvais article/tenant, quantité nulle, rebut, droits, modules désactivés et reprise concurrente.
- **686 tests unitaires API, 964 Shared et 146 Web** réussis.
- **33 scénarios Chromium distincts** réussis : production réelle multi-lots, réponse perdue
  puis refus intermédiaire et reprise exacte sans doublon, journal vers OF, lecteur sans droit
  d’écriture, tutoriel première visite, régressions WMS/scanners et déclarations sans lot.
  Deux scénarios Fabrication rejoués après la dernière finition de libellé.
- Captures bureau/mobile inspectées, tutoriel compris; aucun débordement à 390 px.
- Svelte : zéro erreur et douze avertissements préexistants. Builds Shared/API/Web réussis,
  SPA statique générée. `git diff --check` propre; `.env` inchangé.
- Le test de changement de comptage attend désormais la fin du premier chargement avant de
  demander le second, puis vérifie réellement sa requête suspendue : pas de délai arbitraire
  ni d’assouplissement du verrou de l’application.

## Limites et suite

Pas de réservation, allocation par pièce, généalogie récursive globale, numéro de série,
FEFO/quarantaine, rappel réglementaire, recette process/coproducts, coût de revient ou correction
compensatoire. Le registre des identités/dates de lots reste immuable. Un même lot produit
peut recevoir plusieurs déclarations; consulter son journal ne constitue pas une allocation.
Les historiques complets d’OF restent non paginés dans ce panneau, comme dans le parcours existant.

Suite recommandée : corrections compensatoires gouvernées des déclarations avant gestion
avancée qualité/quarantaine; qualifier ensuite les besoins de recherche de généalogie transitive.
Résultats vérifiés : [état du projet](../etat-du-projet.md). Recette uniquement dans la base locale
isolée `pulsar_enduser_20260921`; aucun envoi, push, PR ou déploiement serveur.
