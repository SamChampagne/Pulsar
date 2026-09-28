# Finance — paiements historiques partiellement affectés

## Périmètre livré : I2m.2d.2c

Extension de la [reprise des paiements](billing-payment-qualification.md), dans
Finance → **Reprise du journal**. Le writer historique de paiement comptabilise
la somme des affectations, pas nécessairement le montant déclaré du paiement.
Ce lot permet de documenter la devise de cette écriture existante sans inventer
la destination du reste. Il n'ajoute aucun encaissement, décaissement ou crédit.

Exemple : un paiement déclare **15,01 CAD**, dont **12,34 CAD** affectés aux
factures. Si son journal historique est de 12,34, seule cette portion peut être
qualifiée. Les **2,67 CAD** restants demeurent hors journal. Ils ne deviennent ni
crédit client, ni avance fournisseur, ni preuve d'un mouvement bancaire.

## Contrat et contrôles

- `paymentAllocationAmounts` et `reconcilePaymentLedger` utilisent les cents
  exacts de Shared : montant déclaré positif, au moins une affectation, toutes
  strictement positives, somme inférieure ou égale au montant déclaré.
- Le journal doit correspondre exactement à la somme affectée. Les contrôles
  préexistants de tiers, factures, tenant, devise source, statut, date, comptes et
  unicité des écritures sont conservés. Aucune ventilation n'est déduite d'un libellé.
- `allocatedAmount`, `unallocatedAmount`, `allocationState` et la portée
  `ALLOCATIONS_ONLY` sont renvoyés dans le dossier et capturés dans les nouveaux
  instantanés de revue, version 4. Modifier le montant déclaré ou une affectation
  invalide une revue en attente, même si le journal est resté identique.
- Justificatif protégé, motif documenté, revue et confirmation humaine restent
  obligatoires. Source, montants, comptes, dates, affectations, soldes des factures
  et devise NULL du journal ne sont jamais réécrits par cette qualification.
- Original et contrepassation NULL existante sont qualifiés ou retirés ensemble.
  Une annulation ultérieure inverse les lignes originales, et non le montant
  déclaré ou les comptes actuellement configurés. Elle transporte l'annotation
  dans la même transaction; aucune contrepassation du reste non comptabilisé.
- Verrous business tenant → paiement → GL, versions, contrôle des droits source,
  révision append-only, annotation et audit atomiques restent ceux du lot précédent.
  La concurrence annulation/qualification ne laisse pas un groupe partiellement
  qualifié. L'échec d'audit annule la décision complète.
- Les reprises utilisent la même clé, le même acteur et le même corps. Les réponses
  et instantanés antérieurement enregistrés ne sont pas réécrits lors d'un replay.
- **Le rapprochement bancaire reste bloqué tant que le paiement est partiellement
  affecté**, même après qualification et même pour une transaction égale à la seule
  portion comptabilisée. Le contrôle d'affectation complète n'a pas été assoupli.
- Finance reste autonome : mêmes permissions, aucune activation TMS, aucun nouvel
  endpoint, outil IA, privilège ou migration de schéma.

## Interface, aide et tutoriel

Le dossier utilise les composants Pulsar existants : **Montant déclaré**,
**Affecté et comptabilisé**, **Reste non comptabilisé**, puis un avertissement
explicite sur la portée. La revue répète les deux montants concernés avant la
confirmation. La devise source reste en lecture seule.

Une dix-huitième leçon Finance explique ce cas par l'exemple, et l'aide de page
ainsi que la Documentation intégrée décrivent le lien paiement → factures →
journal → banque. Aucun reset des tutoriels déjà vus par les utilisateurs.

## Cas non couverts

Un paiement sans affectation, suraffecté, avec une affectation nulle/négative,
sans journal, ou dont le journal porte le montant déclaré complet malgré des
affectations partielles reste refusé. Même exigence pour une contrepassation
inexacte. Les écritures déjà à devise connue ne sont pas des cibles de reprise.

Ce lot ne permet pas de compléter les affectations d'un paiement soumis, ne
crée pas de compte d'avances et ne certifie pas la réalité des fonds reçus.
Pas de change, de lettrage nouveau, de clôture ni de fiscalité recalculée.

## Vérification

Tests Shared de calcul exact, HTTP des deux sens RECEIVE/PAY, invariance des
dossiers, annulation, retrait, changement de source, écritures incohérentes,
banque bloquée, audit rollback/reprise et concurrence. Parcours navigateur
preuve → revue → confirmation → retrait, avec lecture bureau et mobile 390 px.
Résultats datés dans [le point de reprise](../etat-du-projet.md).

Extension livrée ensuite : [factures transporteur ajustées avec acceptation tracée](billing-accepted-carrier-qualification.md).
Suite : formes comptables non standard, plans d'actifs historiques,
puis périodes/clôtures et change explicites avant sous-livre fournisseur et
lettrage. La cible comptable Pulsar/externe reste configurable par entreprise.
