# E1b.4 — publication et remise des factures clients

Lot local du 2026-09-24, `codex/pilot-business-depth`. Suite de
[E1b.3](credit-document-coordinates.md), dans l’univers UI existant de Pulsar.
Facturation reste autonome; le portail ne se branche que s’il est activé.

## Parcours opérateur

1. Préparer puis approuver la facture. Les coordonnées sélectionnées sur le brouillon
   sont figées à l’approbation selon E1b.1. Aucun courriel client ne part à l’approbation.
2. Ouvrir **Document et envoi de la facture**. Vérifier nom/adresse/inscriptions de
   l’émetteur proposés par les nouveaux réglages `customerInvoiceIssuer*`, distincts
   des réglages d’avoirs. Aucune identité fiscale historique n’est inventée.
3. Choisir **Reprendre la copie de la facture** ou confirmer une saisie manuelle;
   celle-ci exige un motif si une copie historique utilisable existe.
4. Confirmer puis **Figer et générer le PDF**. Les lignes, quantités, taxes et montants
   sont ceux approuvés. Une incohérence de somme/décomposition bloque la publication,
   sans recalcul fiscal ni correction de la facture d’origine.
5. Télécharger et vérifier le document. Publication et approbation ont des dates
   distinctes en UTC. Le document n’est ni une preuve de paiement ni un solde actualisé.
6. Saisir le destinataire ou reprendre séparément le contact figé, vérifier qu’il est
   toujours approprié, puis confirmer le canal : simulation sans envoi ou SMTP réel.
   Changer le courriel retire la confirmation; le contact ne confère aucun droit portail.
7. Après coupure, **Actualiser le document et l’envoi**. Ne pas créer une autre facture
   pour contourner une remise incertaine. Le journal distingue simulation, file, remise
   acceptée par le serveur et incertitude; il ne garantit jamais réception ou lecture.

La publication, la remise et les paiements sont séparés. Ni simulation ni mise en file
ne transforment la facture en `SENT`. Les anciens statuts `SENT` restent historiques.
Une facture `APPROVED` peut être encaissée via le circuit Paiements existant; le raccourci
de paiement complet accepte désormais aussi cet état, avec les mêmes gardes et écritures.

## Contrats et protection

- Migration additive **115**, `20260924040000_customer_invoice_documents` : instantané,
  empreinte de demande, auteur/date de publication, fichier canonique et SHA-256. FK
  composites tenant/auteur et tenant/document, contraintes de complétude. Aucun backfill.
- Publication autorisée seulement hors DRAFT; lecture + gestion des factures clients.
  Verrou de ligne tenant/facture, relecture serveur et contrôle de la copie sélectionnée.
  Les coordonnées manuelles ne se mélangent jamais avec la source INVOICE.
- JSON de publication immuable, reprenant les preuves approuvées et la provenance.
  Empreinte normalisée de la demande, indépendante de l’ordre des clés JSON. Un rejeu
  identique reprend ce snapshot avant toute nouvelle lecture d’identité courante.
- Stockage via `DocumentsService`, type réservé `customer-invoice-pdf`; rattachement
  conditionnel du premier fichier. Une panne conserve le snapshot. Un perdant concurrent
  peut laisser un fichier protégé orphelin; aucune suppression après réponse incertaine.
- Pas de téléchargement/suppression/composition générique de ces fichiers. Le PDF est
  vérifié avant téléchargement, avant demande d’envoi et juste avant remise. Fichier
  absent/corrompu ou pièce jointe non canonique : arrêt, jamais envoi sans document.
- `MailService` partage la voie financière gardée des avoirs : module revérifié,
  claim atomique, canal capturé, pièce jointe obligatoire, incertitude persistée avant
  SMTP, aucun retry après tentative. Pas de nouvel outil mutating ou d’autorité agent.
- Envoi exige lecture + `billing.customer-invoices.send`. Destinataire, empreinte PDF,
  canal et confirmation explicites. Une clé durable par tenant/facture/canal garantit
  un seul envoi SMTP et une simulation. Une adresse différente sur rejeu est refusée.
- Le portail conserve ses gardes module/tenant/client/statut visible. Si une publication
  existe, seul le PDF canonique avec bonne empreinte est servi. Publication incomplète
  ou fichier indisponible = 404, jamais repli sur un autre fichier. Sans publication,
  le téléchargement historique reste compatible; il n’est pas requalifié rétroactivement.
- Aucun carnet privé, adresse de livraison, téléphone, email descriptif, identifiant
  interne ou motif de dérogation n’est imprimé. Le snapshot conserve les prix unitaires
  sources, mais le PDF imprime quantités et montants de ligne approuvés, pas une
  reconstitution du détail des remises/ajustements historiques.

## Changement de compatibilité volontaire

L’ancien `POST /billing/customer-invoices/:id/send` répond **409** avec orientation vers
le nouveau parcours. Il ne déduit plus le destinataire depuis la fiche actuelle et ne
joint plus un PDF arbitraire. Les éventuels appels agents/integrations doivent faire
l’objet d’une revue; aucun outil nouveau ne permet de contourner la confirmation.

`autoSendOnApproval` ne concerne plus les factures clients (les relevés transporteurs
gardent leur comportement); `autoEmailInvoicePdf` reste lisible pour compatibilité,
mais est explicitement indiqué inactif. Les réglages existants ne sont pas effacés.

Les anciens messages facture en attente/échec sans canal qualifié sont arrêtés avec
`INVOICE_LEGACY_REVIEW_REQUIRED`, jamais remis automatiquement. Un ancien historique
de message, `sentAt` ou statut `SENT` bloque un nouvel envoi depuis ce premier circuit.
Consulter les journaux fournisseur avant intervention. Pas encore de procédure UI de
réconciliation d’une remise historique ou de renvoi à un autre destinataire.

Déploiement futur : sauvegarder, arrêter les anciennes instances API/workers, appliquer
les migrations et redémarrer la nouvelle version. **Ne pas mélanger ancien et nouveau
sender en rolling deployment** : l’ancien code n’applique pas ces gardes. Qualifier SMTP
uniquement avec un destinataire de test explicitement autorisé.

## Recette et limites

Tests : reprise de stockage, publications concurrentes, ordre JSON différent, mauvais
hash/canal, permissions, isolation tenant, source historique modifiée/désactivée,
sommes et taxes incohérentes, ancien envoi bloqué, voies génériques refusées, dedup
courriel, portail fail-closed. Les suites vente/paiement existantes vérifient leur
compatibilité sans dépendre de l’ancien raccourci d’envoi.

Recette navigateur : perte de réponse APRÈS publication et APRÈS mise en file, relecture,
téléchargement, confirmation invalidée à l’édition, absence de second bouton d’envoi,
facture toujours APPROVED après simulation, écrans ordinateur/mobile et tutoriel.
Les fixtures `INV-UI-…`/`PDF-UI-…` de `module-autonomy` utilisent une base de recette;
elles sont consommées, donc à recréer avant le prochain passage.

Documentation intégrée Facturation et tutoriel métier enrichis, sans relancer les tours
déjà vus. Gabarit français/latin occidental, pas de certification fiscale, échéancier,
logo, conditions contractuelles configurables ou détail des remises reconstruit.
Pas de remboursement, facture électronique réglementaire, preuve de lecture, livraison
SMTP garantie ni procédure de renvoi. Commandes CRM/fournisseurs, identités multiples
et autres documents du rapport restent les prochains incréments.

Migration appliquée uniquement à `pulsar_enduser_20260921`, `.env` inchangé.
Aucun SMTP réel, commit, push, PR ou déploiement effectué.

Résultats finaux : 686 tests unitaires API, 129 tests Web, tests Shared réussis;
134 HTTP distincts sur sept suites (des suites ont été rejouées après correction de
fixtures et ajout de cas). Trois parcours Chromium finaux réussis, dont première
ouverture du tutoriel et non-réapparition. PDF téléchargé rendu en PNG et inspecté,
extraction vérifiant identité/adresse historiques, total et absence de notes privées,
courriel, identité courante et prix unitaire pouvant suggérer un ajustement non prouvé.
Captures desktop/mobile inspectées, panneau sans débordement à 390 px, zéro erreur JS.
Builds Shared/Database/API/Web réussis; zéro erreur Svelte, douze avertissements
préexistants. Contrôles d’empreinte/portail et rendu rejoués après les derniers ajustements.
