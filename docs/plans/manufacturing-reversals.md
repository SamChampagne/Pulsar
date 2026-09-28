# Fabrication — corrections compensatoires I2e

25 septembre 2026 · branche locale `codex/pilot-business-depth`.

## Parcours et sens métier

Dans **OF → Atelier et stock réel → Corriger une déclaration**, sélectionner la déclaration,
examiner les effets, expliquer l’erreur et confirmer la situation physique. La correction est
une **contrepassation complète**, pas une édition de l’original : retirer la production bonne,
restituer chaque consommation au même article, lot et emplacement, puis retirer bons/rebuts
du décompte actif de l’OF. Saisir la déclaration correcte est ensuite une action distincte.

Cela corrige une **erreur d’enregistrement**, pas une transformation physique réellement
effectuée. Ce n’est ni du désassemblage, ni un retour client, ni un remplacement de lot.
L’opérateur doit vérifier la situation physique; un solde disponible ne prouve pas l’identité
de chaque pièce. Aucune remontée automatique de la chaîne aval et aucun transfert depuis un
autre emplacement pour financer la correction.

Seuls les OF **IN_PROGRESS** et les preuves **v2** compatibles sont éligibles. Les OF terminés
ne sont pas rouverts; les preuves v1 restent consultables mais non corrigibles par ce parcours.
Une déclaration uniquement rebutée, sans consommation, peut être contrepassée sans mouvement.
Les produits finis doivent être disponibles en totalité dans le lot/bin d’origine. Manque,
article/unité/SKU incompatible, emplacement/site inactif, preuve incohérente : refus explicite.

## Modèle et transaction

Migration additive `20260925030000_manufacturing_reversals` : table dédiée
`ManufacturingDeclarationReversal`, une par déclaration et une par clé d’opération/tenant.
FK composites tenant/déclaration et tenant/auteur, relations restrictives et motif obligatoire.
L’original, son fingerprint, ses quantités et sa preuve restent inchangés. La nouvelle preuve
capture effets inverses, identifiants des mouvements originaux et compensatoires, lot/bin/unité,
quantités, motif/auteur/date et token de revue. Aucun backfill ou changement de schéma des preuves v1.

Le writer prend le verrou tenant WMS avant replay/relecture. Il vérifie version d’OF et hash
de la revue, puis crée correction, nouveaux mouvements **ADJUSTMENT** via
`InventoryService.postMovement`, soldes agrégés/par lot et nouvelle version d’OF dans la même
transaction. Le retrait du produit précède les restitutions matières. Échec même en cours de
transaction ⇒ rollback complet. Audit après commit via le service existant.

Le hash couvre effets, preuve originale, version et disponibilités lues. La prévisualisation
ne réserve rien : tout est revérifié au writer. Elle n’est pas une certification d’absence
de mouvements depuis la lecture (un aller-retour à solde égal peut rester compatible).
Pas de changement de statut d’OF, aucun passage hors state machine.

## API et droits

Préfixe `api/v1/manufacturing/shop-floor/orders/:orderId/declarations/:declarationId` :

- GET `reversal-preview` : manufacturing.read + wms.read, les deux modules activés.
  Renvoie les effets, motifs bloquants, version et token; aucune écriture.
- POST `reverse` : mêmes lectures + manufacturing.manage + wms.manage.
  Corps fermé : `operationKey`, `expectedUpdatedAt`, `reviewToken`, `reason`.
  Le serveur choisit toutes les cibles et quantités depuis le journal vérifié; aucune quantité,
  identité de lot ou de tenant acceptée du client.

Replay exact lié tenant/acteur/OF/déclaration/corps avant contrôles version/statut/stock.
Même clé différente ou autre clé sur une déclaration déjà contrepassée ⇒ conflit. Droits et
activation restent contrôlés, même en reprise. Aucun endpoint de suppression/édition de correction
et aucun nouvel outil mutating pour l’IA.

## Connexions intermodules

- **OF** : compteurs bons/rebuts/restant et contrôle de clôture calculés sur les déclarations
  non contrepassées. Un replay de l’original ne le réactive pas et ne recrée pas son stock.
- **Impacts matières** : seules les consommations actives réduisent le besoin théorique.
  La restitution est déjà dans WMS, jamais ajoutée une seconde fois.
- **MRP** : nouvelles captures conservent original + correction; hash actualisé et anciennes
  captures immuables. Une déclaration contrepassée ne libère pas le garde MAKE inter-calcul.
  Le contexte du worker explique cette distinction, sans nouveau pouvoir de correction.
- **APS** : historique d’exécution toujours bloquant pour la replanification globale sans
  temps réels par opération, même si toutes les déclarations sont contrepassées. L’annulation
  de l’OF reste également interdite après cet historique. Aucun temps restant n’est inventé.
- **WMS** : journal `refType=manufacturing-reversal` vers OF avec Fabrication activée et droit
  de lecture. L’original et sa correction ont des filtres distincts; aucun mouvement masqué.

## Interface, aide et reprise

Panneau et composants Pulsar conservés. Revue inline distincte du formulaire de production,
effets lisibles sur mobile, motif et attestation explicites. L’intention exacte est conservée
avant envoi par tenant/utilisateur/OF. Une réponse incertaine, un reload ou un refus intermédiaire
de reprise ne changent pas la clé ni le contenu. Stockage indisponible ⇒ aucun envoi. Intention
corrompue ⇒ blocage avec invitation à examiner le journal avant toute réinitialisation.

Une demande initiale refusée définitivement garde la saisie mais exige une nouvelle revue;
une reprise refusée conserve l’intention originale. La preuve historique indique « contrepassée »
et pointe vers les mouvements compensatoires. La documentation embarquée décrit les liens et
limites; le tutoriel Fabrication passe à six étapes métier. Aucun reset des utilisateurs existants,
aucun nouveau bouton tutoriel.

## Limites et prochaine étape

Pas de correction partielle, de réouverture d’OF terminé, de correction d’une correction,
de remboursement financier, de coût de revient, de réservation ou de reconstitution historique.
Un nouveau déclaratif corrigé n’est pas créé automatiquement, ni lié comme un remplacement formel.
Historique complet non paginé comme précédemment; prévisualisation bornée par les 200 consommations
de la déclaration. Les lots restent immuables.

Suite : qualifier la gestion qualité/quarantaine et les mouvements autorisés, puis la recherche
de généalogie transitive. La correction d’exécution déjà engagée en aval demandera un workflow
distinct, pas un assouplissement de cette contrepassation.

## Vérification et livraison

Recette : **230 HTTP sur treize suites** (puis 64 ciblés rejoués après durcissement),
**686 unitaires API**, **148 unitaires Web** et **35 scénarios Chromium distincts** réussis.
Couverture : double envoi concurrent, clé/corps/acteur, revue périmée, stock indisponible,
preuve v1 refusée, OF terminé, modules/droits, rebut sans mouvement, panne injectée au second
mouvement avec rollback, quantités nettes/clôture et capture MRP avant/après correction.
UI réelle : réponse perdue après commit, refus intermédiaire puis reprise exacte sans doublon;
stock navigateur indisponible ⇒ aucun POST, journal vers OF, lecture seule, tutoriel et mobile.
Captures bureau/mobile inspectées; aucun débordement à 390 px.
Svelte : zéro erreur, douze avertissements préexistants. Builds Database/API/Web réussis,
SPA statique générée, `git diff --check` propre.

Base locale isolée `pulsar_enduser_20260921` uniquement; `.env` inchangé. Migration 124 additive,
aucune fixture métier dans Acme. Aucun push, PR ou déploiement serveur. Résultats de recette :
[état du projet](../etat-du-projet.md).
