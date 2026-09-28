# E1b.2 — commandes Transport et engagement cohérent

Suite de [E1b.1](document-coordinates.md), 2026-09-24.

## Parcours

Dans Transport, préparer le Carnet du client, puis ouvrir une commande brouillon.
Le panneau **Coordonnées** reprend le sélecteur utilisé dans Services et Facturation.
Choisir une adresse de facturation, une adresse de livraison commerciale et/ou un contact,
donner un motif, enregistrer puis confirmer la commande revue. Les choix restent facultatifs.
Le dialogue de confirmation explique le gel; les actions attendent la fin de la sauvegarde.
Un carnet modifié demande une sélection explicite de la nouvelle version. Après engagement,
la copie reste consultable même si le carnet est modifié ou désactivé.

L'adresse de livraison commerciale **ne remplace pas** la Location de destination. L'origine,
la destination, les expéditions, la tournée et le connaissement utilisent toujours les lieux
opérationnels. Aucun courriel, accès portail, facture ou calcul fiscal n'est déclenché.
Le BOL accessible au chauffeur ne reçoit pas les coordonnées commerciales privées.

## Contrat et compatibilité

- Colonne nullable `TransportOrder.documentCoordinates`, migration additive sans backfill.
- GET/PATCH `/transportation/transport-orders/:id/coordinates` : Transport activé et lecture
  des commandes; PATCH exige aussi gestion des commandes et lecture du référentiel Transport.
  Aucun droit ni activation Clients, Services ou Facturation n'est nécessaire.
- Le service commun résout l'identité et toutes les références côté serveur. Même propriétaire,
  tenant, type, version et validité civile que E1b.1. Aucune copie fournie par le navigateur.
- L'édition et les transitions relisent sous verrou business tenant puis écrivent par CAS
  statut/version. Le gel du choix et CONFIRMED sont dans la même transaction.
- `expectedUpdatedAt` reste facultatif pour les anciens appels sans capture. Il est obligatoire
  pour modifier/confirmer une commande portant une capture. L'UI transmet toujours la version
  revue à la confirmation. Les agents/connecteurs ne gagnent aucun pouvoir : sans version,
  leur confirmation d'une commande capturée est refusée.
- Retirer explicitement les trois choix avec motif avant de changer le client d'un brouillon.
  Une commande engagée reste non éditable selon son workflow; pas de réécriture historique.
- La planification prend le même verrou : numérotation, création de toutes les expéditions
  et statut PLANNED sont atomiques. Une ligne invalide annule le lot entier; deux planifications
  concurrentes ne créent qu'un lot. L'ajout ultérieur d'une expédition vérifie PLANNED par CAS
  et avance la version. Aucun nouveau mécanisme de réservation de stock.
- Pas de reçu idempotent pour ces actions historiques : après réponse incertaine, relire les
  expéditions avant de réessayer. En particulier, ne pas répéter aveuglément un ajout.

## Limites et suite

Ce lot couvre les **commandes Transport**, pas les commandes CRM ou fournisseurs. Les PDF/envois
gardent leur comportement actuel : la séparation document commercial / connaissement / facture
et la revue du destinataire doivent précéder toute propagation. La séparation donneur d'ordre,
livré, facturé et payeur reste un incrément distinct; ces usages d'adresse ne sont pas quatre
personnes morales. Les 271 fiches de l'audit ne sont pas clôturées par ce lot.

Le tutoriel Transport est désormais un scénario métier spécifique dans le système de première
ouverture existant; aucune remise à zéro ni bouton de tutoriel ajouté. La documentation intégrée
explique gel, droits, planification et limites.

## Recette

Migration appliquée exclusivement à `pulsar_enduser_20260921`, sans reset ni modification du `.env`.
Tests HTTP : module Transport seul, inter-tenant, droits lecteur, falsification, incohérence de
type, versions périmées, carnet corrigé, gel et conservation après désactivation; lieux inchangés,
pas d'email ou compte portail. Concurrence édition/confirmation, rollback de planification
multi-lignes, double planification et ajout post-planification.
Recette navigateur partagée avec Services/Facturation : choix, réponse perdue simulée après commit,
relecture, nouvelle version, confirmation et affichage ordinateur/mobile.

Résultats : 85 tests HTTP sur trois suites (autonomie, passerelle CRM et fulfillment WMS),
666 tests unitaires API et 129 Web réussis. Les 48 tests d'autonomie ont été rejoués après ajout
des cas retrait/changement de client et gestionnaire sans lecture du carnet. Quatre parcours
navigateur finaux : tutoriel Transport première visite sans réapparition, puis coordonnées
Services, Facturation et Transport. Les trois copies sont contrôlées sur ordinateur/mobile.
La revue visuelle a trouvé une colonne mobile coupée malgré l'absence de scroll de la page;
grille corrigée et test renforcé sur les bornes réelles du panneau. Captures finales inspectées.
Builds Database/API/Web réussis; Svelte sans erreur, douze avertissements préexistants.
`git diff --check` propre. Aucun envoi réel, push, PR ou déploiement.

Pour rejouer : exécuter `module-autonomy.e2e-spec.ts` sur la base isolée, puis renseigner
`PULSAR_AUTONOMY_TENANT_PREFIX` avec son nouveau préfixe et lancer
`document-coordinates.spec.ts`. Recréer les fixtures pour la recette complète : le test approuve
réellement une facture et enregistre la première visite du lecteur Transport.
