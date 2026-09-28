# Finance I2m.2a — écritures et rapports par devise

Date : 2026-09-27. Branche locale : `codex/pilot-business-depth`.
Suite de [l’échéancier fournisseur opérationnel](./billing-supplier-schedules.md).

## Objectif et périmètre

Empêcher qu’un grand livre ou un rapport additionne CAD et USD ou attribue une
devise supposée à son historique. Sécuriser la saisie manuelle et sa reprise,
sans transformer le registre fournisseur documentaire en dette comptabilisée.
Finance fonctionne seul, avec le même bureau et les composants Pulsar existants.

Ce lot ne décide pas du maître comptable officiel. Le choix Pulsar natif vs
logiciel externe a été posé à l’utilisateur, sans réponse présumée. Les périodes,
la devise fonctionnelle, les taux figés et le sous-livre fournisseur restent à
concevoir après ce choix. Les vues livrées sont des contrôles, pas des états
comptables officiels ou consolidés.

## Contrat de devise et historique

- `JournalEntry.currency` nullable; valeurs CAD, USD, EUR, MXN, GBP contrôlées par
  le catalogue partagé et une contrainte SQL. `fingerprint` nullable pour la reprise
  manuelle. Index tenant/devise/date. Pas de valeur par défaut ni de backfill.
- Nouvelles écritures de facture client/transporteur, avoir client et paiement :
  devise explicite issue du document, jamais du défaut courant du tenant.
- Une source déjà comptabilisée ne change pas. Le replay historique NULL ne la
  requalifie pas; une source connue dans une autre devise provoque un conflit.
- Une contrepassation de paiement conserve la devise de l’écriture originale,
  y compris NULL. Original absent ou devise connue différente du paiement : refus
  atomique, sans annuler le paiement ni ses allocations.
- Un avoir client ne compense pas un original NULL ou d’une autre devise : revue
  comptable requise. L’ancien parcours créant un original absent lors de la
  confirmation conserve ses contrôles et capture alors la devise de la facture.
- À la livraison I2m.2a, les immobilisations n’avaient pas de devise source.
  Depuis [I2m.2c](billing-fixed-assets-currency.md), les nouveaux actifs et dotations
  capturent une devise explicite. Les anciens restent non qualifiés en lecture seule;
  leurs écritures NULL sont exclues et comptées dans la couverture des rapports.
- Rapprochement bancaire : devise du journal de paiement identique à celle du
  compte. NULL ne suffit pas. Aucun changement de montant ou de devise historique.
- Variance budgétaire : refus si les comptes concernés contiennent NULL ou plusieurs
  devises. Le budget lui-même n’a pas encore de contrat de devise; son calcul
  mono-devise historique n’est pas annoncé comme une consolidation multidevise.

Migration additive **133** : `20260927040000_ledger_currency`. Appliquée seulement
à `pulsar_enduser_20260921@localhost:5432`; aucune migration métier/OVH dans ce lot.

## Montants, dates et lectures

`billing/ledger-exact.ts` est la source partagée de calcul en cents BigInt.
Chaînes décimales exactes dans les réponses; pas de Number pour les agrégats GL,
résultats, bilan, flux ou âgés. Les sommes SQL NUMERIC sont regroupées en base
par compte, avec tenant sur chaque jointure. Les zéros de précision SQL sont
acceptés; une fraction de cent non nulle n’est jamais arrondie silencieusement.

Les balances et rapports GL lisent sommes et couverture dans une transaction
RepeatableRead. Une devise doit être choisie explicitement. La couverture donne
les écritures incluses, les entrées NULL exclues et les comptes d’autres devises
exclues, dans la même période. Le journal peut montrer toutes les devises mais
n’en calcule aucun total commun; filtre `unqualified=true` pour NULL. Les
empreintes de reprise ne sont pas exposées.

Dates de requête civiles réelles AAAA-MM-JJ, 1900–2199, début <= fin; fin incluse
jusqu’à 23:59:59.999 UTC. Une date de saisie reste civile, sans décalage de fuseau.
Balance sans borne = toutes les dates, y compris futures, annoncé dans l’interface.

Les âgés AR et AP sont volontairement renommés/expliqués : **soldes actuels
classés par ancienneté d’approbation/création**, pas une reconstitution à une date
historique ni un âge d’échéance contractuelle. AR soustrait paiements et avoirs
clients actuels; AP concerne exclusivement les transporteurs. Les factures
fournisseur générales I2l et leur échéancier I2m.1 restent indépendants.

Un équilibre arithmétique ne prouve ni la complétude ni la conformité des états.
Les auto-postings de facture existants restent best-effort : leur succès doit
être rapproché des pièces sources. Pas de compte de résultat consolidé par
conversion, revalorisation, exercice fermé, export certifié ou déclaration fiscale.

## Saisie manuelle et reprise

Réglage `ledgerManualEntries` actif; permissions `billing.ledger.read` ET
`billing.ledger.manage`. Les autres lectures demandent `billing.ledger.read`.
Tous les endpoints sont gardés par Billing et le tenant du JWT.

1. Choisir la date civile, la devise et 2 à 200 lignes. Chaque ligne porte un
   débit OU un crédit positif, deux décimales au plus, maximum 9 999 999 999,99.
   Les comptes doivent être actifs et appartenir au tenant. Équilibre au cent près.
2. Confirmer explicitement. La demande UUID v4 est conservée avant tout envoi dans
   un emplacement navigateur propre au tenant/utilisateur. Échec de stockage ⇒
   aucun envoi. Les champs sont bloqués pendant confirmation/envoi et reprise.
3. Le writer prend un verrou transactionnel de grand livre tenant avant lookup.
   Empreinte liée à l’acteur et au corps normalisé; même demande ⇒ même écriture,
   autre acteur ou corps ⇒ 409. Replay avant revalidation des comptes devenus inactifs.
4. Journal, lignes et audit sont atomiques. `AuditLogsService.log(..., tx)` propage
   une erreur transactionnelle; les autres appels conservent leur best-effort.
5. Après réponse perdue, Vérifier l’écriture ou Reprendre la même écriture. Le
   rechargement restaure aussi l’affichage des champs exacts. Aucun nouvel UUID,
   effacement ou abandon silencieux d’une demande incertaine. Une demande invalide
   ou bloquée peut exiger une intervention opérateur; pas de clôture de demande
   ni de preuve durable d’absence permettant un abandon automatique dans ce lot.

API modifiée : `POST /billing/ledger/entries` exige maintenant `operationKey`,
`currency`, `date`. Nouveau `GET /billing/ledger/requests/:key`, limité à l’acteur.
`GET /billing/ledger/trial-balance` et les cinq `/billing/reports/*` exigent
`currency`; les montants de rapport sont des chaînes exactes. Adapter les anciens
consommateurs; les tests et clients Pulsar ont été mis à jour. L’outil agent READ
`get_trial_balance` exige lui aussi une devise et une date civile valide; aucun
outil mutating ni nouveau contournement de gouvernance ajouté.

## UX et documentation

Sélecteurs explicites sans CAD choisi silencieusement, panneau de portée partagé,
lien vers le journal historique, effacement des anciens résultats en erreur,
réponses tardives ignorées. Drawer natif, confirmation et reprise persistante.
Tableaux contenus sur mobile, indication de défilement horizontal, montants exacts
groupés et tabulaires. Pas de nouveau thème ou dépendance UI.

Aide `?` des pages Grand livre/Rapports, documentation Finance enrichie dans
Documentation et douzième leçon spécifique du premier tutoriel Billing. Aucun
reset de progression et aucun bouton permanent de tutoriel ajouté.

## Preuves de vérification

- Shared : grands cumuls au-delà de la précision IEEE, centimes, SQL scale,
  lignes non valides, équilibre, bilan/résultat/flux et classement des soldes.
- HTTP dédié : tenant/module/droits, concurrence et reprise acteur/corps,
  replay compte désactivé, rollback de l’audit, devises/NULL, borne finale UTC,
  exactitude SQL, paiement et contrepassation, rapprochement bancaire refusé sur
  NULL, avoir client bloqué puis émis, budgets ambigus et fractions de cent.
- Régressions HTTP : factures/avoirs/dossiers/échéanciers fournisseur; grand
  livre, rapports, budgets, immobilisations, paiements et banque historiques.
- Chromium : choix de devise, exclusions visibles, grands montants exacts,
  réponses tardives ignorées, erreur sans ancien total, lecteur sans mutations,
  confirmation, commit/réponse perdue/403/reload/replay sans doublon; bureau/390 px.
  Premier tutoriel fournisseur toujours affiché une seule fois.

Résultats finaux consignés dans [l’état du projet](../etat-du-projet.md).

## Suite, dans cet ordre

1. Décider du maître comptable et des responsabilités Pulsar/externe.
2. Contrat de devise fonctionnelle et qualification historique avec preuves;
   jamais inférer depuis la configuration actuelle. Traiter les immobilisations
   et budgets comme sources à qualifier, pas comme exceptions implicites.
3. Périodes et dates de comptabilisation : droits fermeture/réouverture, verrous
   partagés entre tous les writers, ajustements et contrepassations append-only.
4. Sous-livre fournisseur : reconnaissance explicite, journal atomique ou export
   idempotent confirmé, lien GL et rapprochement. Pas de dette déduite du planning.
5. Allocations, paiements partiels, lettrage, change et véritable balance âgée
   historique réconciliée. Étendre les travailleurs IA après ces contrats seulement.

Repère conceptuel : [Odoo 19 — Multi-currency system](https://www.odoo.com/documentation/19.0/applications/finance/accounting/get_started/multi_currency.html)
distingue devises des transactions, devise de l’entreprise et écarts de change.
Cette référence ne constitue pas une validation comptable ou fiscale de Pulsar.
