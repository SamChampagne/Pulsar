# Finance I2m.2d.2a — reprise des paiements historiques

## Parcours livré

Finance → Reprise du journal traite désormais les paiements clients et transporteurs
à devise originale NULL, en plus du parcours manuel. Ce n’est pas la reprise des
factures sources ni des immobilisations. Finance reste autonome; Transport n’est
pas requis. Aucun nouveau pouvoir agent, conversion, clôture ou paiement externe.

1. Ouvrir l’écriture originale : le dossier rapproche le paiement, son tiers,
   sa devise, ses affectations et les comptes réellement utilisés.
2. Conserver un justificatif protégé. La devise attestée doit égaler celle du
   paiement; aucun choix de conversion ni défaut provenant du tenant.
3. Préparer la revue, vérifier la portée puis confirmer avec le droit distinct
   `billing.ledger.qualify`. `billing.ledger.read` et `billing.payments.read` sont
   requis; les factures ne sont pas exposées sans leurs droits de lecture.
4. Une décision couvre l’original et sa contrepassation existante ensemble.
   Depuis une contrepassation, ouvrir le dossier original avec le bouton dédié.
5. Retirer exige un motif, une preuve et une nouvelle revue; toutes les écritures
   du groupe redeviennent exclues ensemble. Les décisions ne sont jamais effacées.

## Invariants

- Seuls les paiements SUBMITTED/CANCELLED entièrement affectés sont acceptés.
  Montant positif, somme exacte des affectations, tiers/devise et cumul par facture
  cohérents; exactement un original et zéro/une contrepassation selon le statut.
  Propriété de chaque ligne/compte/affectation contrôlée dans le tenant. Source
  absente, dupliquée, partiellement affectée ou incohérente : refus explicite.
- Deux comptes distincts dans l’original, structure encaissement/décaissement
  compatible; chaque contrepassation neutralise exactement les mêmes comptes.
  Calculs Shared en cents exacts, jamais arrondis pour rendre un historique valide.
- Original et contrepassation conservent leur devise NULL, leurs montants, comptes
  et dates. Annotation courante séparée, `sourceEntryId` vers l’original et FK
  composite tenant/source (migration additive 137). Aucun backfill.
- Une révision append-only sur l’original porte le snapshot, les écritures
  concernées, l’empreinte des affectations, le justificatif et l’acteur. Les versions
  des annotations enfants restent alignées; aucune qualification indépendante.
- Confirmation : verrou business tenant → ligne paiement → verrou GL, compatible
  avec annulation/rapprochement bancaire. Source revue de nouveau sous verrou;
  token périmé rejeté. Annotation, révision et audit atomiques.
- UUID/acteur/corps pour preuve et confirmation; replay de la décision enregistrée
  avant revalidation du nouvel état. Droits source vérifiés aussi sur replay,
  historique, preuves et téléchargement. Une réponse perdue ne justifie pas une
  nouvelle clé. Les originaux de factures ne sont pas révélés par le snapshot.
- Annuler inverse les lignes réellement postées, jamais les réglages actuels de
  mode de paiement/AR/AP. Si la devise historique est qualifiée, la contrepassation
  reçoit la même annotation et sa provenance dans la transaction d’annulation.
  Audit impossible ⇒ aucun changement de paiement, solde facture, journal ou
  annotation. Les comptes d’origine doivent encore être actifs pour poster.
- Banque : une annotation QUALIFIED issue de ce paiement satisfait le contrôle de
  devise du journal. Les autres contrôles (montant, devise bancaire, compte réel,
  mode, statut) restent obligatoires. Retirer le rapprochement bancaire avant de
  modifier la qualification, pour ne pas invalider une preuve déjà utilisée.
- Rapports et budgets utilisent les annotations existantes, sans nouvelle agrégation
  ni total interdevises. Un paiement annulé et sa contrepassation se neutralisent
  seulement si tous deux sont inclus dans la période consultée.

## Interface et documentation

L’écran Pulsar existant est conservé : liste/dossier responsive, synthèse source,
montant/devise, nombre d’affectations et portée original/contrepassation. Devise
source en lecture seule, blocages explicites, lien vers le registre des paiements.
Preuve → revue → confirmation, reprise persistante après coupure/403. Le tutoriel
Finance est enrichi sans réinitialiser les tours déjà complétés.

## Validation locale (2026-09-27)

- Migration 137 appliquée uniquement à `pulsar_enduser_20260921`, sans seed global
  ni modification `.env`.
- 1 996 unitaires : Shared 1 084, API 691, Web 221.
- 118 HTTP distincts dans 7 suites : qualification, devise du journal, paiements,
  banque, ledger, flux Finance et immobilisations. Droits révoqués, neutralisation
  de balance, preuve, stale review, original/annulation et rollback d’audit vérifiés.
- 5 scénarios Chromium : manuel, reprise réseau/403, droits source, paiement avec
  qualification/retrait et synthèse responsive. Captures bureau et 390 px inspectées.
  `Input.readonly` corrigé; pas de compilation concurrente pendant le rejeu UI.
- Aucun commit, push, PR, déploiement ni donnée métier réelle migrée.
- Recontrôle final : 14 tests HTTP du lot réussis après regroupement des lectures
  de factures. Builds Shared/Database/API/Web réussis; Svelte 0 erreur et
  12 avertissements préexistants. API isolée 3100 et proxy Web : readiness 200.

## Limites et suite

Extension livrée ensuite : [I2m.2d.2c](billing-partial-payment-qualification.md)
accepte les paiements partiellement affectés dont le journal correspond exactement
aux affectations. Le reste demeure hors comptabilité et la banque reste bloquée.
Les [factures et avoirs](billing-invoice-qualification.md) ont leur reprise dédiée.
Les limites suivantes décrivent le périmètre initial I2m.2d.2a.

Les anciens paiements partiellement affectés, les factures et les amortissements
exigent des lots dédiés. Une qualification ne certifie pas la légalité d’une pièce,
ne refait pas les taxes et ne crée pas de sous-livre fournisseur général. Les
comptes historiques inactifs restent lisibles mais une annulation exige leur
réactivation explicite. Le rapprochement bancaire continue d’exiger un mode
compatible avec le compte bancaire actuel.

Prochain lot : reprise des factures historiques et de leurs documents compensatoires
sur preuves; ensuite plans d’actifs historiques, périodes/clôtures et change.
La cible comptable Pulsar/externe reste configurable par entreprise.
