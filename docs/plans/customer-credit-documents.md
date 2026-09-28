# Avoirs clients — publication PDF et envoi explicite

Lot local du 2026-09-23, `codex/pilot-business-depth`. Complète les
[avoirs internes](customer-credit-notes.md), sans changer le calcul comptable,
les paiements ou le circuit de retour physique Services/WMS.

## Parcours opérateur

1. Facturation → facture client → **Avoirs et solde client** → avoir validé.
2. Ouvrir **Document et envoi client**. Confirmer le nom légal, l’adresse,
   les inscriptions fiscales de l’émetteur et l’identité du client. Les réglages
   Facturation `creditIssuerName`, `creditIssuerAddress`, `creditIssuerTaxIds`
   préremplissent l’émetteur. Aucune adresse client n’est devinée depuis un quai.
   Depuis E1b.3, **Reprendre la copie de la facture** sélectionne explicitement son
   identité/adresse de facturation figées. Une saisie différente exige un motif si cette
   source existe; les anciens documents sans source restent en saisie manuelle.
   [Provenance et limites](credit-document-coordinates.md).
3. **Figer et générer le PDF**. Le document est daté au moment de cette confirmation;
   la date comptable d’origine est affichée séparément. Toutes deux sont UTC.
   Un ancien avoir n’est pas antidaté ni enrichi automatiquement d’identités historiques.
4. Télécharger et vérifier le PDF. Le droit de validation permet sa publication;
   le droit distinct `billing.credit-notes.send` permet l’envoi (lecture facture requise).
5. Saisir le courriel puis confirmer explicitement le mode affiché. `log` est une
   simulation sans envoi externe. `smtp` remet un véritable courriel au transport.
   La simulation ne se transforme jamais toute seule en envoi SMTP.
   Le contact de la copie facture peut être repris par un bouton distinct après publication;
   son adresse doit être vérifiée. Changer le destinataire retire la confirmation.
6. Actualiser l’historique. « Accepté par le serveur » n’est pas une preuve de
   livraison au destinataire. En cas d’échec ou résultat incertain, vérifier le
   journal et le fournisseur : ne pas recréer l’avoir pour contourner le contrôle.

## Contrats et sécurité

- Migration additive **109** : champs nullable de publication sur `CustomerCreditNote`;
  `EmailMessage.deliveryChannel` et `deliveryUncertain`. Aucun backfill historique.
- Verrou de ligne tenant/facture/avoir avant capture; seuls les `ISSUED` sont publiables.
  Empreinte des coordonnées et un seul instantané canonique. Rejeu identique admis,
  remplacement des coordonnées refusé. Publication et remise sont auditées.
- Le rendu lit uniquement cet instantané : identités, numéro source, dates, devise,
  motif, quantités et décomposition des taxes provenant de l’avoir déjà figé.
  Aucun recalcul fiscal, de facture, de GL ou de stock.
- Fichier via `DocumentsService`, type réservé `customer-credit-pdf`. Téléchargement
  par l’endpoint Facturation uniquement; refus des voies génériques de consultation,
  création, suppression et composition courriel. FK composite tenant/document.
- Stockage hors transaction : le premier rattachement conditionnel gagne. En cas
  de panne, l’instantané est réutilisé. Un rendu concurrent perdant peut laisser un
  fichier protégé non rattaché; aucun effacement automatique après réponse incertaine.
  Sa réconciliation technique reste à construire. Le PDF canonique n’est jamais remplacé.
- SHA-256 vérifié au téléchargement et juste avant remise. PDF manquant/corrompu ou
  pièce jointe non canonique = blocage; aucun courriel sans PDF dans ce circuit.
- File existante `MailService`, type réservé `customer-credit`, garde fail-closed,
  activation Facturation revérifiée avant remise. Le cache d’activation conserve son
  TTL existant de 30 s entre instances; ce lot n’ajoute pas de coordination distribuée.
- Clé durable `(tenantId, customer-credit:<id>:<log|smtp>:v1)`. Une simulation et
  un envoi réel maximum; collision avec une autre adresse = 409. Une répétition
  renvoie l’historique, y compris après échec. Changement de canal avant remise = blocage.
- Claim `QUEUED → SENDING` conditionnel. Incertitude persistée avant l’appel SMTP;
  succès enregistré `SENT` l’efface. Erreur après remise possible = `FAILED` incertain,
  sans `nextAttemptAt`. Crash en `SENDING` = inspection manuelle, jamais renvoi automatique.
  Même un échec certain avant remise n’expose pas encore de bouton de reprise.
- Aucun outil mutating supplémentaire pour les agents. Aucun envoi réel effectué
  pendant les tests de ce lot (fournisseur simulé HTTP, pilote log en navigateur).

## Mentions et limites

Les champs couvrent les identités, inscriptions et ajustements décrits par les
[règles canadiennes sur les notes de crédit](https://laws-lois.justice.gc.ca/eng/regulations/SOR-91-44/section-3.html)
et l’explication de [Revenu Québec sur les retours de biens](https://www.revenuquebec.ca/fr/entreprises/taxes/tpstvh-et-tvq/situations-particulieres-liees-a-la-tpstvh-et-a-la-tvq/retours-de-biens/).
Ces références guident les champs, pas une certification du logiciel. L’opérateur
reste responsable de la justesse des inscriptions, de la remise et des règles de
sa juridiction. Un libellé saisi n’est pas une inscription fiscale vérifiée.

Gabarit français, caractères latins occidentaux, sans logo ou signature. Pas de
PDF dans le portail client, preuve de lecture, correction d’identité après publication,
renvoi à une autre adresse, note de débit, remboursement ou transfert inter-factures.
`SENT` en mode log signifie simulation; les anciens messages sans `deliveryChannel`
ne sont pas rétroactivement qualifiés. L’historique détaillé de remise est dans l’avoir.

## Recette

Vérifié localement : 908 tests partagés, 657 unitaires API, 123 unitaires web;
74 HTTP sur trois suites puis 15 connectés dont un nouveau cas (75 distincts).
Deux parcours navigateur finaux réussis (avoir et documentation/tutoriel), écran
mobile contrôlé. API/web compilés; typage web sans erreur, 12 avertissements
préexistants. Schéma isolé sans divergence après migration 109. Aucun déploiement.

- Unités : PDF simple/multipage; pièce jointe manquante, mauvaise empreinte,
  simulation devenue SMTP, garde retirée, claim concurrent, résultat SMTP ambigu,
  succès fournisseur suivi d’échec DB; aucun rejeu d’une remise.
- HTTP/PostgreSQL : publication/rejeu, identité devenue obsolète, droits distincts,
  isolation tenant et module, voies document/courriel génériques refusées,
  destinataire concurrent, déduplication et facture financière inchangée.
- Navigateur : réponse de publication perdue, relecture du PDF canonique,
  téléchargement, simulation clairement affichée, absence de second bouton d’envoi,
  écrans ordinateur/mobile et PDF inspectés.
- Documentation et tutoriel Facturation enrichis, liens Facturation–Courriel explicités;
  aucune réinitialisation du tutoriel par utilisateur ni nouveau bouton permanent.

## Suite recommandée

Qualifier les identités réelles et SMTP sur le pilote VPS avec un destinataire de
test expressément autorisé. Ensuite : procédure opérateur de résolution/reprise
des remises (certaines versus incertaines), correction par document compensatoire,
puis remboursement/affectation d’un crédit avec rapprochement bancaire.
