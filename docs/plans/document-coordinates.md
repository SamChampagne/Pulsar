# E1b.1 — coordonnées choisies et figées dans les documents

Date : 2026-09-24. Suite de [E1a](enterprise-audit-program.md).
Périmètre : **devis Services et factures clients**, pas encore commandes Transport/CRM,
achats, affiliations ou quatre identités transactionnelles distinctes.

Suite livrée dans [E1b.2 — commandes Transport](transport-order-coordinates.md).
Le périmètre ci-dessous décrit le premier incrément, pas l'état complet du programme.

## Parcours et effet métier

1. Préparer une adresse/contact dans le carnet du client depuis Données ou Clients.
2. Ouvrir un devis Services enregistré ou un relevé client brouillon dans Facturation.
3. Dans **Coordonnées du document**, choisir explicitement les entrées pour facturation,
   livraison/intervention et contact. Les trois usages sont facultatifs; une même adresse
   peut couvrir deux usages. Un contact ne peut pas être utilisé comme adresse.
4. Enregistrer avec un motif. Le serveur copie les données et leur version, ainsi que
   l’identité actuelle du propriétaire. Aucun contenu de snapshot n’est accepté du navigateur.
5. Avant l’engagement, revoir tout avertissement : carnet modifié, entrée désactivée,
   période échue, identité changée ou client inactif. Choisir la version à jour est explicite.
6. Accepter le devis ou approuver la facture. Le workflow recontrôle tout sous verrou et
   fige les coordonnées **dans la même transaction** que son changement d’état.

Le choix d’un contact est descriptif. Il ne change pas le destinataire de courriel, le
PDF, les droits portail, les taxes ou la Location d’une opération. Une adresse de facture
n’est ni un payeur distinct ni une règle fiscale. Un devis accepté n’est pas une signature
externe. Une facture approuvée n’est ni envoyée, ni réglée par cette sélection.
Les réglages existants d’envoi automatique à l’approbation restent indépendants et inchangés.

## Contrats

- Deux colonnes JSON additives `documentCoordinates` (ServiceQuote/CustomerInvoice),
  version de contrat `schemaVersion: 1`. Pas de backfill, de fusion ni de nouvelle entité client.
- Propriétaire imposé par le document, jamais par le corps HTTP. Services utilise BusinessPartner,
  Facturation Customer; aucun rapprochement par nom ou adresse et aucun transfert implicite entre eux.
- Chaque sélection est `{id, version}`; la copie contient données, version, identité du client,
  auteur, motif, instant du choix, date/fuseau de contrôle et instant de gel éventuel.
- L’entretien du carnet continue via E1a. Les deux nouveaux GET/PATCH sont
  `/services/quotes/:id/coordinates` et `/billing/customer-invoices/:id/coordinates`.
  Ils exigent le module consommateur et ses droits de lecture/gestion, sans activation Clients,
  Catalogue ou Transport. Le module partagé n’importe aucun contrôleur métier.
- PATCH remplace les trois choix avec `expectedUpdatedAt` et un motif de 3–500 caractères.
  Des références absentes, d’un autre client/tenant, de mauvais type, expirées ou de version
  périmée sont refusées. Trois valeurs null retirent explicitement la sélection du brouillon.
- L’édition et le gel prennent le verrou tenant partagé avec le carnet. Les writers relisent
  le document puis effectuent un CAS statut + version. Les lectures d’identité prennent aussi
  un verrou de ligne partagé pour coordonner les writers historiques Customer.
- La date de validité vient du fuseau métier `connectedOperations.timeZone` du tenant,
  America/Toronto par défaut. Début inclus, fin exclue. L’écran affiche cette date et ce fuseau;
  les instants d’historique suivent le fuseau utilisateur. Le gel recontrôle le jour courant.
- L’acceptation du devis exige déjà `expectedUpdatedAt`. L’approbation d’une facture munie
  de coordonnées exige maintenant aussi cette version; les anciens appels sans version
  restent possibles uniquement pour les factures sans capture. Les anciens automatisateurs
  ne peuvent pas approuver une facture capturée sans ajouter une revue explicite de version.
- Changer le client d’un devis portant une sélection est refusé : retirer les choix avec motif,
  changer le client, puis choisir dans le nouveau carnet. Les copies engagées sont immuables.
- Un échec ou une réponse incertaine de PATCH bloque la répétition depuis le formulaire.
  **Vérifier le document enregistré** relit l’état réel avant une nouvelle sélection. Contrairement
  au carnet E1a, cet endpoint n’a pas de reçu idempotent : une ancienne version obtient 409,
  jamais une réapplication aveugle. Les changements sont audités selon l’audit best-effort existant.

## Compatibilité et limites explicites

- Les documents sans capture restent sans capture, même après approbation. La fiche du client
  affichée ailleurs est une référence courante, pas une identité historique prétendument prouvée.
- Une annulation de devis ferme l’édition, sans la présenter comme un accord accepté.
- Le projet créé conserve le lien à son devis accepté; aucune adresse opérationnelle n’est modifiée.
- Au jalon E1b.1, PDF, emails et avoirs gardaient leurs parcours actuels. E1b.3 raccorde
  explicitement la copie au [PDF d’avoir](credit-document-coordinates.md), sans envoi implicite.
  Les autres sorties, commandes CRM/fournisseurs, l’impact transversal et la séparation
  donneur d’ordre/livré/facturé/payeur restent à faire. Les commandes Transport sont couvertes
  par E1b.2. Le registre des 271 fiches n’est pas clôturé par ces incréments.
- Pas de nouvelle autorité IA, de révocation d’accès liée au contact, de rétention/anonymisation,
  de validation postale, ni de changement de politique comptable/fiscale.

## Validation

Migration `20260924020000_document_coordinates` appliquée uniquement à
`pulsar_enduser_20260921` (113 migrations). Aucun reset, changement de `.env` ou de base utilisateur.
Tests HTTP : autonomie de Services et Facturation seuls, droits limités, mauvais propriétaire,
payload falsifié, type incompatible, concurrence, version attendue à l’engagement, reprise
périmée, carnet modifié et copie conservée après désactivation. Tests partagés : validité civile,
version, disparition, type et absence de mutation des copies. Les tests navigateur rejouent
sélection, réponse perdue après commit, relecture, mise à jour explicite et gel.

Documentation intégrée Clients/Services/Facturation et tutoriels Services/Facturation actualisés;
pas de remise à zéro de la progression des utilisateurs.

Résultats : 935 tests partagés, 666 tests unitaires API, 129 tests Web et 95 tests HTTP
réussis. Les 46 scénarios d’autonomie ont été rejoués après ajout du cas de double édition
concurrente. Cinq parcours navigateur vérifiés : deux sur les coordonnées document et trois
sur le carnet existant. Le parcours Facturation a révélé un clic d’approbation possible avant
fin de sauvegarde : le serveur refusait bien la version périmée; l’UI lie désormais son état
occupé aux actions du document. Les deux parcours passent après correction. Captures finales
ordinateur/mobile inspectées après fin des transitions. Builds Shared/Database/API/Web réussis;
Svelte : zéro erreur, douze avertissements préexistants. `git diff --check` propre.

La recette navigateur utilise les fixtures HTTP isolées et
`PULSAR_AUTONOMY_TENANT_PREFIX`. Régénérer ces fixtures avant une nouvelle recette complète :
le parcours Facturation approuve réellement sa facture `CO-UI-…` de test.
Aucune action externe, aucun envoi réel, commit, push, PR ou déploiement dans ce lot.
