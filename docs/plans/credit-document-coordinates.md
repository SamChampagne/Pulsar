# E1b.3 — coordonnées de facture dans l’avoir client

Lot local du 2026-09-24, `codex/pilot-business-depth`. Prolonge les
[coordonnées document](document-coordinates.md) et le circuit
[PDF/envoi d’avoir](customer-credit-documents.md). C’est un incrément de l’audit,
pas une généralisation à tous les documents ni une nouvelle règle fiscale.

## Parcours et liens entre modules

1. Dans Facturation, choisir les versions d’adresse/contact du carnet sur la facture
   brouillon; l’approbation fige sa copie avec l’identité du client facturable.
2. Après validation d’un avoir, ouvrir **Document et envoi client**.
3. **Reprendre la copie de la facture** sélectionne son identité et son adresse
   de facturation historiques. L’écran montre la date et la version. Une adresse
   désactivée depuis reste la preuve de ce qui a été capturé, pas une adresse actuelle.
4. Une **saisie manuelle** reste possible. Si une copie utilisable existe, un motif
   est obligatoire; sinon aucune adresse historique n’est inventée. Les anciennes
   publications restent sans provenance enregistrée : pas de backfill.
5. Vérifier l’émetteur et les inscriptions fiscales, confirmer puis **Figer et générer**.
   Changer un champ retire la confirmation. Télécharger et vérifier le document.
6. Le bouton **Reprendre le courriel du contact figé** est séparé. Il propose une ancienne
   adresse à vérifier, ne l’envoie pas et ne la publie pas sur le PDF. On peut saisir
   un autre destinataire. Toute modification retire la confirmation d’envoi.
7. Vérifier simulation/SMTP et confirmer. Après réponse incertaine, **Actualiser le document
   et l’envoi** avant toute reprise. Le PDF et la remise restent dédoublonnés.

Facturation seule suffit : ses façades Données donnent accès au carnet avec ses propres
droits. Clients, Transport, Services et Catalogue ne deviennent pas des dépendances.
L’avoir ne modifie ni la facture source ni le stock, ne déclenche aucun remboursement
et n’accorde aucun droit portail. Les adresses opérationnelles et le BOL chauffeur restent séparés.

## Contrats techniques

- `invoiceCreditRecipient` projette seulement une copie de schéma reconnu, gelée,
  appartenant au client facturable de cette facture et portant une adresse valide
  structurellement. Aucune lecture du carnet actuel et aucun contrôle de validité à la date
  actuelle : cela détruirait la valeur historique de la copie.
- Le mode `INVOICE` exige `expectedCoordinatesHash`. Le serveur résout nom/adresse,
  refuse les champs manuels mélangés et recontrôle l’empreinte au premier gel.
  L’empreinte couvre facture, propriétaire, identité, adresse/version, date de gel et
  courriel descriptif capturé. Une source absente/différente renvoie 409.
- La provenance est ajoutée au JSON existant `documentSnapshot` : `INVOICE` avec références,
  version/date/empreinte et courriel descriptif; `MANUAL` avec motif éventuel. Aucune migration.
- Le PDF n’imprime que l’identité et l’adresse retenues, plus une légende de date de copie.
  Pas de notes du carnet, adresse de livraison, téléphone, courriel, ID interne ou motif
  interne de dérogation. Les montants/taxes restent ceux de l’avoir validé, sans recalcul.
- Publication sous verrou de l’avoir tenant/facture, instantané immutable, fichier via
  `DocumentsService` et rattachement conditionnel existants. Une panne de stockage conserve
  le même instantané. Le rejeu compare la demande figée AVANT de résoudre la source actuelle.
  Les empreintes des anciennes publications manuelles restent compatibles.
- Lecture facture + `billing.credit-notes.approve` pour publier; lecture facture +
  `billing.credit-notes.send` pour envoyer. Isolation tenant et garde Facturation inchangées.
- Envoi via le circuit existant : destinataire explicite, confirmation, empreinte du PDF,
  canal attendu, clé durable par avoir/canal; aucune relance implicite ou nouvelle autorité IA.

## Recette locale

- 674 tests unitaires API, dont projection historique et rendu PDF; tests ciblés rejoués
  après ajout de la liaison entre empreinte et courriel capturé.
- 64 tests HTTP (`connected-business` et `module-autonomy`) : source historique malgré
  client modifié/carnet désactivé, falsification, versions, permissions, saisie manuelle avec
  motif, panne de stockage et publication concurrente; reprises du circuit existant.
- 129 tests Web. Parcours Chromium en Facturation seule : approbation d’une facture avec
  copie, publication réellement commise puis réponse perdue, relecture et téléchargement,
  confirmation invalidée à l’édition, destinataire choisi séparément, simulation sans SMTP.
- PDF téléchargé rendu en PNG et inspecté; extraction contrôlant identité/adresse/légende
  et absence de notes privées, contact email et identité actuelle. Captures desktop/mobile
  inspectées, sans débordement du panneau à 390 px ni erreur JavaScript.
- Deuxième parcours Chromium : étape spécifique du tutoriel, non-réapparition après
  rechargement et contenu de Documentation. Deux parcours navigateur réussis au total.
- Builds API/Web réussis, zéro erreur Svelte et douze avertissements préexistants.
- Base isolée `pulsar_enduser_20260921`, `.env` inchangé, aucune migration ni action externe.

Documentation intégrée et étape du tutoriel Facturation enrichies. Aucun bouton métier
permanent ajouté, aucune remise à zéro de la progression des utilisateurs.
La recette navigateur utilise les fixtures HTTP dédiées `PDF-UI-…` et
`PULSAR_AUTONOMY_TENANT_PREFIX`; elle approuve réellement sa facture et enregistre le tutoriel
du lecteur de recette. Régénérer ces fixtures avant une nouvelle exécution complète.

## Limites et suite

- Ce lot concerne le **PDF d’avoir**, pas encore le PDF de la facture, du devis, des commandes
  CRM/fournisseurs ou du BOL. Il ne transfère pas automatiquement la copie devis vers facture.
- Pas de changement d’identité après publication, d’envoi à plusieurs destinataires, de
  second envoi libre, de preuve de réception, de remboursement bancaire ou de certification fiscale.
- Gabarit existant français/latin occidental; autres caractères refusés explicitement avant gel.
- Circuit PDF/envoi de la facture livré ensuite dans [E1b.4](customer-invoice-documents.md)
  (document canonique, destinataire et reprise contrôlés). Restent les commandes CRM/fournisseurs.
  La qualification SMTP sur VPS exige une configuration et un destinataire de test autorisé.
