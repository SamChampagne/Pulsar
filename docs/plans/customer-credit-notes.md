# Avoirs clients — correction financière et retour physique

Lot local du programme `pilot-business-depth`, 22–23 septembre 2026.
Il prolonge les [retours partiels Services](services-partial-returns.md).
Il ne termine pas les cinq axes et n’autorise ni déploiement ni envoi client.

## Parcours livré

1. Ouvrir une facture client approuvée, envoyée ou payée dans **Facturation**.
2. Dans **Avoirs et solde client**, préparer un avoir : quantités des lignes
   originales et motif obligatoire. Le brouillon présente les montants et taxes.
3. Vérifier, puis confirmer la validation avec le droit dédié. Un brouillon peut
   être annulé, un avoir émis reste définitif. Aucun montant historique n’est réécrit.
4. Lire séparément montant original, encaissements réels, avoirs validés et restant
   dû. Un solde créditeur est explicitement **à traiter**, jamais déclaré remboursé.
5. Pour une pièce Services physiquement revenue : ouvrir **Pièces et stock**,
   sélectionner l’avoir validé et confirmer quantité/motif. Le mouvement WMS est
   distinct de l’avoir; il retourne vers l’emplacement d’origine.

Un geste commercial peut donner lieu à un avoir sans retour physique. Une facture
brouillon continue de se corriger par suppression/recréation explicite; aucun avoir
ne peut être créé sur un brouillon. Les liens depuis le projet vers la facture
restent le point d’entrée. La fiche conserve le design et les composants Pulsar.

## Contrats

- `CustomerCreditNote` et `CustomerCreditLine` sont des tables propres, tenant-scopées.
  Les liens facture, auteur et émetteur sont des FK composites incluant le tenant.
  La ligne historique de facture n’a pas de tenant scalaire : le service vérifie
  son appartenance à la facture lue sous tenant avant toute création de ligne d’avoir.
- États partagés : DRAFT → ISSUED ou CANCELLED. Aucun retour à DRAFT, édition ou
  suppression d’un avoir émis. Numérotation `SequencesService`, clé `customer-credit`,
  préfixe AVC; des numéros peuvent être consommés lors d’un refus/rejeu, jamais réutilisés.
- Création : `billing.customer-invoices.read` + `.manage`. Émission : lecture +
  `billing.credit-notes.approve`. Annulation du brouillon : lecture + gestion.
  Module Billing obligatoire. Le droit séparé ne force pas deux personnes distinctes.
- Une création garde sa clé UUID et son contenu dans le navigateur, par tenant,
  utilisateur et facture, **avant** envoi. Rejeu même auteur/contenu = même avoir;
  autre contenu = conflit. Stockage illisible/indisponible : ne pas inventer de nouvelle
  demande, faire vérifier l’état. Émission/annulation sont elles aussi idempotentes.
- Verrou de ligne sur la facture. Chaque brouillon capture `creditVersion`;
  chaque émission l’incrémente. Deux brouillons concurrents peuvent exister, mais
  le second devient périmé après émission du premier : annuler puis recréer.
- Les quantités déjà émises sont déduites par ligne; les brouillons et annulations
  ne réservent pas de quantité. Pas de nouvelle ligne sans source ni de prix libre.
  Quantités à quatre décimales; montant à deux. Une ligne sans quantité ou dont la
  quantité a plus de quatre décimales utilise une fraction de ligne (1 = totalité).
- Le calcul pur `calculateCustomerCredit` utilise des entiers : chaque taxe figée
  est répartie sur les lignes au prorata des montants nets, par plus forts restes
  (identifiant de ligne comme départage stable). Les retours successifs créditent
  la différence entre deux arrondis cumulés, évitant les centimes excédentaires.
  Un instantané incohérent ou un avoir nul est refusé, pas réparé silencieusement.
- `creditedAmount` et `creditVersion` sont un cache transactionnel de la facture.
  `totalAmount`, `taxAmount`, `taxDetail`, lignes et `amountPaid` ne sont jamais
  changés par un avoir. `PAID` conserve son sens historique d’encaissement brut;
  un solde nul par compensation peut rester APPROVED/SENT.

## Comptabilité, règlements et portail

L’émission poste une écriture compensatoire (`customer-credit`, `issued`) dans la
même transaction que le statut et le cumul crédité : débit produit/taxes, crédit
créance. L’écriture originale fait autorité pour les comptes de créance et produit;
les comptes de taxes viennent de l’instantané et sont comparés à l’écriture.
Une écriture non standard est bloquée pour revue; on ne l’inverse pas approximativement.

Si l’écriture originale manque (comptabilisation historique best-effort), la
confirmation explicite la poste depuis la facture figée, puis l’avoir, atomiquement.
Les comptes actifs doivent exister. Le service de journal conserve son audit
best-effort préexistant, réalisé via une connexion séparée : pas d’outbox d’audit
transactionnelle ajoutée dans ce lot.

`invoiceBalance` sépare dû et crédit client. Écran d’allocation, soumission de
paiement, paiement rapide, créances âgées et portail lisent le cumul crédité.
Le claim de paiement vérifie aussi le cumul d’avoirs, pour refuser un calcul devenu
périmé. Annuler un encaissement ne supprime pas les avoirs. Le portail affiche les
montants crédités et le restant dû, sans exposer de références internes de l’avoir.

## Retour Services après facturation

Une ligne d’avoir ISSUED liée à la même consommation autorise au maximum sa quantité
moins les retours physiques déjà liés. Le retour vérifie aussi le restant physique,
le projet actif, l’emplacement et l’unité d’origine. Verrous existants conservés :
business tenant → WMS tenant; `InventoryService.postMovement` reste l’unique writer
de stock. Journal, solde et `ServicePartReturn.creditLineId` sont atomiques.
Le fingerprint du retour intègre la ligne d’avoir; changer de ligne avec la même clé
est refusé. Les anciens rejouages sans avoir restent compatibles.

Le lecteur Services reçoit seulement le numéro d’avoir, l’identifiant de ligne et
la quantité encore retournable, jamais ses montants ni les coordonnées client.
Activer/désactiver Billing ne déplace aucun stock; retourner exige les droits Services
et WMS habituels. Aucune facture supplémentaire n’est créée après un retour crédité.

## Limites explicites

- Circuit interne, sans PDF fiscal d’avoir, envoi client, remboursement bancaire,
  transfert de crédit entre factures, compensation multi-devises ou note de débit.
- Pas d’émission autonome par agent ni d’outil AI mutating ajouté.
- Au plus 100 avoirs affichés par facture; calcul des soldes sur tout l’historique.
- L’historique de la facture et ses sources ne sont pas rouverts par l’avoir.
- Les identités légales et numéros de taxes figés ainsi que les mentions du document
  externe restent à implémenter/qualifier avant émission fiscale au client.
  Référence à vérifier avec la comptabilité : [ARC — remboursement, redressement ou
  crédit de TPS/TVH](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/12-2/refund-adjustment-credit-gst-hst-under-section-232-excise-tax-act.html).
  Aucune conformité fiscale globale n’est revendiquée.

## Qualification locale

- Migration additive 108 appliquée uniquement à `pulsar_enduser_20260921`;
  comparaison Prisma/base sans différence. `.env` et base utilisateur non modifiés.
- 908 tests partagés dont sept de calcul/états/arrondis; 648 tests unitaires API.
- 123 tests web réussis dans 19 suites, dont reprise persistée et contrats documentaires.
- 73 scénarios HTTP réussis : fondations métier (36), parcours connectés (13),
  paiements (24). Taxation figée, tiers successifs, somme finale exacte,
  concurrence émission/rejeu, isolation, droits/module, rollback comptable,
  crédits sur facture payée, plafonnement/correction de paiement et retour borné.
- Chromium : parcours réel préparation → réponse perdue → recharge/reprise → émission
  → solde → retour physique séparé. Captures ordinateur/mobile inspectées, pas de
  débordement. Trois scénarios réussis dans la passe finale, avec régressions du
  tutoriel/documentation et des retours partiels non facturés. Autres modules non
  retestés exhaustivement dans ce lot.
- API et web compilés; typage web sans erreur, 12 avertissements préexistants.
  Les suites Jest HTTP nécessitent encore `--forceExit` (dette préexistante).

La documentation intégrée, ses liens Services/WMS/Facturation et le contenu du
tutoriel Facturation sont actualisés sans réinitialiser la progression utilisateur.
Pas de nouveau bouton permanent, PR, push, envoi client ou déploiement VPS.

## Suite recommandée

La [publication PDF et la remise explicite](customer-credit-documents.md) sont désormais
implémentées dans le lot suivant, à qualifier sur le pilote. Traiter séparément les
remboursements et transferts avec rapprochement bancaire et décisions auditées.
L’axe parcours complets conserve ensuite les retours/rapprochements fournisseurs,
quarantaine Qualité et replanification Fabrication en cours.
