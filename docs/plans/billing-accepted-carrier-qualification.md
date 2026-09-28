# Finance — reprise des factures transporteur ajustées

## Périmètre I2m.2d.2d

Extension de la [reprise des factures](billing-invoice-qualification.md) pour une
facture transporteur historique dont le montant accepté après litige diffère des
lignes attendues et taxes figées. Finance → **Reprise du journal** conserve les
trois réalités : lignes attendues, montants reçus, payable accepté. Aucune ancienne
ligne n'est corrigée pour la faire coïncider avec le journal.

Le workflow `resolveDispute(ACCEPT_INVOICED)` conserve volontairement les montants
attendus des lignes; le total du document devient le payable. La résolution est
enregistrée dans l'audit, pas dans un champ `Invoice.resolution`. Une égalité entre
total reçu et payable ne suffit donc jamais à prouver une acceptation.

## Éligibilité et rapprochement

- Facture APPROVED/PAID, devise source connue, tiers et loads des lignes dans le
  même tenant, journal original unique à devise NULL. Droits de lecture GL et
  `billing.invoices.read` sur dossier, preuve, téléchargement et replay; mutation
  humaine avec `billing.ledger.qualify`. Aucun besoin d'activer Transport.
- Référence transporteur non vide, dates de rapprochement et approbation présentes
  et ordonnées, raison du litige et montants de rapprochement renseignés.
- Une seule décision de résolution dans l'audit tenant/entityType/entityId :
  `STATUS_CHANGE`, DISPUTED → APPROVED, `ACCEPT_INVOICED`, raison identique, acteur
  appartenant au tenant, date d'audit non antérieure à l'approbation. Une résolution
  KEEP_EXPECTED, absente, multiple ou incohérente bloque la reprise ajustée.
- L'audit ancien atteste le **type de décision**, pas une empreinte des montants
  de l'époque. La cohérence des données conservées et le justificatif humain
  restent nécessaires; aucun historique manquant n'est fabriqué.
- `reconcileAcceptedCarrierAmounts` (Shared, cents BigInt) vérifie chaque ligne :
  attendu/reçu non négatifs, reçu − attendu = écart capturé. Somme reçue = total
  reçu = payable; somme des écarts signés = varianceTotal; somme des valeurs
  absolues = varianceGross. Pas de compensation silencieuse entre écarts.
- Le payable demeure le total du document. Hors taxes comptabilisé = payable −
  taxes figées, strictement positif. `reconcileInvoiceLedger` contrôle ensuite
  exactement charge, fournisseur, taxes et comptes réellement postés. Aucun taux
  ou réglage courant n'entre dans le calcul; les taxes ne sont pas recalculées.
- Une écriture encore égale aux anciens montants attendus ne devient pas valide
  parce que le dossier a été accepté. Aucun journal manquant n'est créé.

## Exemple et sens des écarts

| Information conservée                          |    CAD |
| ---------------------------------------------- | -----: |
| Lignes attendues                               | 100,00 |
| Taxes figées                                   |  15,00 |
| Attendu + taxes figées                         | 115,00 |
| Lignes reçues et payable accepté               | 120,00 |
| Hors taxes déjà comptabilisé                   | 105,00 |
| Écart du payable avec l'attendu taxes incluses |   5,00 |
| Écart historique des lignes reçues/attendues   |  20,00 |

Ces deux écarts ne sont pas interchangeables. Le contrat historique de réception
compare les lignes reçues aux attendues sans leur ajouter les taxes. La reprise
ne transforme pas les lignes reçues en ventilation nette/taxes et ne certifie pas
le traitement fiscal; elle conserve et rapproche les faits déjà enregistrés.

## Preuves, versions et absence d'effets opérationnels

Justificatif protégé PDF/PNG/JPEG, motif et revue explicite restent obligatoires.
Le nouveau snapshot v5 capture le rapprochement, les montants et une empreinte de
la décision d'audit. Une modification après revue invalide la confirmation. Les
snapshots et réponses anciennes restent inchangés lors des replays.

Verrous business tenant → facture → GL, version et reprise UUID/acteur/corps du
parcours existant. Annotation, révision et audit de qualification sont atomiques;
une panne d'audit annule tout. Retrait sur preuve sans contrepassation; historique
append-only. Aucun changement de facture, taxe, solde, règlement, coût Transport,
ligne ou devise NULL du journal. Aucun nouveau pouvoir IA, endpoint, permission
ou migration. La cible comptable Pulsar/externe reste inchangée.

L'audit brut, les identifiants utilisateur et les données opérationnelles des
loads ne sont pas exposés par la synthèse; seule la projection utile au dossier
et l'empreinte de provenance sont conservées dans la revue.

## UI, documentation et tutoriel

Le style Pulsar et ses composants sont conservés. Une section spécifique présente
les montants attendus/reçus, le payable, les taxes et l'écart, avec les écarts de
rapprochement secondaires repliables. La confirmation rappelle le payable accepté
et l'absence d'écriture complémentaire. Le texte sur les avoirs clients n'est plus
montré pour une facture transporteur.

L'aide de page, la Documentation intégrée et une dix-neuvième leçon Finance
expliquent ce cas et son exemple sans réinitialiser les tutoriels déjà vus.

## Limites et suite

Le workflow historique de résolution ne garantit pas la présence d'un GL : les
dossiers sans journal demeurent hors reprise. Aucun backfill ou auto-posting ajouté.
Les formes comptables non standard, répartitions multi-charges, nets nuls/négatifs,
preuves d'acceptation manquantes et sources incohérentes restent exclues. Le lot ne
résout pas une correction comptable, une migration ni une conformité fiscale.

Suite : anciens plans d'immobilisations sur preuves, puis périodes/clôtures et
change explicites. Les formes historiques encore exclues demandent un contrat
spécialisé; jamais une dérogation à la qualification manuelle.

## Recette

Tests Shared exacts, écarts compensatoires et limites; HTTP des hausses/baisses,
droits et tenant, acceptation unique, journal/taxes/source incohérents, fraîcheur
après changement d'audit, double confirmation, rollback puis reprise identique.
UI preuve → revue → confirmation → retrait et captures bureau/mobile 390 px.
Les résultats datés figurent dans [le point de reprise](../etat-du-projet.md).
