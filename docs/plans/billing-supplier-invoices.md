# Factures fournisseur générales — I2l.1

## Livrable et usage

Finance → **Factures fournisseur** (`/billing/supplier-invoices`) conserve une facture
reçue et son original. Ce registre est distinct des factures transporteur (`Invoice`,
`IncomingCarrierInvoice`) et des factures/avoirs clients. Finance fonctionne seul :
le fournisseur est un `BusinessPartner` partagé, accessible par la façade
`/billing/data/suppliers`, avec création directe depuis le sélecteur.

Ce lot est une **qualification documentaire**, pas une comptabilité fournisseurs
complète. Le statut QUALIFIED signifie « document vérifié et figé », pas « approuvé
pour paiement », « comptabilisé », « payé », ni « livraison conforme ».

## Parcours utilisateur

1. Choisir/créer un fournisseur actif. Recopier numéro externe, date civile,
   échéance facultative, devise et notes. Le numéro interne FF vient de SequencesService.
2. Saisir 1 à 100 lignes : libellé, quantité positive (4 décimales), unité et montant
   **net déclaré après remises**. Pas de multiplication implicite par un prix d’achat.
3. Recopier les composantes de taxe par libellé et montant, jusqu’à 20. Les 5 devises
   prises en charge sont CAD/USD/EUR/MXN/GBP, avec 2 décimales. Aucune règle fiscale,
   déductibilité ou conversion monétaire n’est inférée. Net + taxes = total exact.
4. Facultativement relier chaque ligne à une ligne de commande confirmée/clôturée.
   Fournisseur, unité et devise doivent correspondre exactement. Le lien conserve la
   quantité et le prix commandés comme contexte; ce n’est pas une validation d’écart.
5. Enregistrer puis conserver l’original PDF/PNG/JPEG (10 Mo/pièce, 30 pièces/dossier).
   Les pièces sont append-only, téléchargées via les droits Finance; pas d’URL générique.
6. Relire le dossier enregistré, sélectionner explicitement l’original, rédiger le
   compte rendu et confirmer le gel. Les modifications non enregistrées bloquent
   cette confirmation. Un qualificateur peut lire/qualifier sans éditer le brouillon.

Les dates de facture/échéance restent des jours civils. Les instants d’historique
et de clôture affichent le fuseau utilisateur. Le tiroir Pulsar, les sélecteurs,
chargements, erreurs, lecture seule et présentation mobile réutilisent les repères existants.
Le guide `redesign-existing-projects` a conduit à conserver les panneaux et composants
Pulsar et à traiter explicitement les états de reprise/lecture échouée, sans nouveau thème.

## Contrat de sécurité et persistance

- Permissions distinctes `billing.supplier-invoices.read`, `.manage`, `.qualify`.
  Le modèle de commis reçoit lecture/gestion; comptable reçoit lecture/qualification.
  Les rôles métier existants ne sont pas réécrits : un administrateur attribue les
  nouveaux droits. Le mécanisme existant PermissionsSyncService les ajoute au rôle
  système admin au démarrage; la session doit ensuite être rafraîchie.
- Toutes les routes sont gated Billing et tenant-scopées. Les writers exigent un
  utilisateur humain actif (pas de service-account ou d’agent).
- `SupplierInvoice`, `SupplierInvoiceLine`, `SupplierInvoiceEvidence`,
  `SupplierInvoiceOperation` sont dédiées. FK composites tenant, index unique numéro
  interne et numéro externe normalisé par fournisseur. L’annulation conserve cette
  unicité : pas de réutilisation silencieuse d’un numéro documentaire.
- DRAFT → QUALIFIED ou CANCELLED uniquement via `canTransitionSupplierInvoice`.
  Version attendue, verrou business tenant, lignes/totaux/opération atomiques.
  Le dossier qualifié et ses lignes ne sont plus modifiables. Annulation uniquement
  sur brouillon; aucune suppression. Les pièces ne sont ajoutables qu’au brouillon.
- Demande liée tenant/acteur/clé/corps exact. Replay avant contrôle de version,
  mais après contrôles d’acteur et d’accès commercial. GET de reprise lié à l’auteur.
- Le justificatif choisi doit appartenir à la même facture. DocumentsService gère
  le stockage et interdit les chemins génériques. SHA-256 du fichier conservé;
  double contrôle sous verrou autour de l’upload, nettoyage d’un fichier surnuméraire
  en course, audit `cleanupRequired` si ce nettoyage échoue.
- Les données d’achat capturées ne sortent qu’avec Purchasing activé et sa lecture.
  Sans droit, la facture reste lisible mais ne révèle ni source ID ni prix/quantité
  d’achat, et on ne peut supprimer le lien pour contourner cette dépendance.
- La source est relue à la qualification : son état doit rester confirmé/clôturé,
  ses données commerciales doivent correspondre à la copie enregistrée. Clôturer
  la commande seule ne réécrit pas sa preuve commerciale capturée.
- Les montants sont calculés en cents BigInt (contrat Shared) et persistés Decimal.
  Contraintes SQL sur totaux, dates, clôture et paire source/instantané.
- Audit des créations/éditions/clôtures et pièces. Historique de 30 opérations
  récentes affiché; le registre durable complet n’est pas tronqué.

## Reprise réseau

Le navigateur conserve le corps exact avant envoi dans un emplacement tenant/user.
Une demande incertaine bloque la suivante. **Vérifier la demande** relit le résultat;
**Reprendre la même demande** garde méthode, contenu et clé. Un refus intermédiaire
de reprise conserve l’intention. Aucune clé neuve pour « réessayer ».

Pour un fichier, seuls son nom, type, taille, empreinte, légende et clé sont conservés
localement. Si la lecture ne retrouve pas l’enregistrement, l’utilisateur resélectionne
le même fichier. Aucun secret ni contenu binaire stocké dans localStorage.

## Limites assumées et suite

- Les [avoirs fournisseur documentaires I2l.2](billing-supplier-credits.md) sont disponibles. Pas de paiement, grand livre, dettes âgées, échéancier
  de trésorerie, approbation budgétaire, allocation des taxes par ligne ou déductibilité.
- Pas de rapprochement commande/réception/facture ni de plafond du cumul facturé
  entre plusieurs factures. Le lien de commande est documentaire, pas une réservation.
- Pas de lien direct aux commandes matières Fabrication ni au retour WMS I2k pour
  ce premier lot. Un retour accepté ne calcule toujours aucun avoir ou remboursement.
- Pas de génération de PDF facture fournisseur : c’est le document reçu qui fait
  foi documentaire. Pas d’OCR, email, publication portail ou nouvelle capacité agent.
- Pas de réouverture d’une facture qualifiée : l’avoir reçu I2l.2 compense des montants
  dans un document séparé sans réécrire la source; les autres corrections restent à définir.

Livré **I2l.2** : avoir fournisseur reçu distinct, rattaché explicitement à une
facture QUALIFIED et ses lignes, montants/cumuls exacts, original protégé, confirmation
humaine. Un lien facultatif au retour WMS capture une révision de son suivi et exige
ses droits; il ne change ni stock ni montants de la facture. La fiscalité/comptabilité
fournisseur devra être qualifiée séparément avant tout posting financier.

## Vérification

- Shared : calcul exact, limites, dates réelles, numéro normalisé, transitions terminales.
- HTTP : Finance seul, droits/tenant/module, doublons concurrents, versions/reprises,
  justificatif exact et protégé, gel/annulation, lien commercial et masquage.
- Navigateur : création, édition, original, qualification, perte de réponse/reprise,
  lecture seule, présentation étroite et contenu documentaire/tutoriel.
- Migration additive 130; essais exclusivement dans `pulsar_enduser_20260921`.

Les résultats exécutés sont consignés dans `docs/etat-du-projet.md`.
