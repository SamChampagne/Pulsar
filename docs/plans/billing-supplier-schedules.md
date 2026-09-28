# Finance I2m.1 — Échéancier fournisseur opérationnel

Statut : implémenté localement le 2026-09-27, validation détaillée dans `docs/etat-du-projet.md`.
Branche `codex/pilot-business-depth`. Suite du dossier fournisseur I2l.3.

## Décision de périmètre

Un échéancier **documentaire et opérationnel**, pas encore un sous-livre de dettes.
L’inspection de `LedgerService`, `FinancialReportsService` et du schéma `JournalEntry`
montre que le grand livre historique ne capture pas la devise et que ses rapports
additionnent les lignes via `Number`. `PaymentsService` ne connaît que les cibles
factures clients et transporteurs, pas les factures fournisseur générales.
Brancher implicitement le nouveau registre à ces mécanismes mélangerait des contrats
et pourrait additionner CAD et USD. Ce lot n’y écrit donc rien.

La qualification fige le document reçu; la confirmation d’échéancier fige des dates
convenues; la comptabilisation et le règlement sont des actes distincts. Une date
dépassée ne prouve pas un impayé. Un zéro couvert par avoirs ne signifie jamais payé.

## Parcours utilisateur

1. Finance → Échéancier fournisseur, ou lien depuis une facture qualifiée/le dossier
   fournisseur. Finance seul suffit, sans Transport, Achats, Catalogue ou WMS.
2. Filtrer par fournisseur (lien du dossier), référence, devise ou état. Appliquer
   une date civile de référence pour classer le **planning courant**. Ce n’est pas
   une balance reconstituée à une date historique.
3. Planifier → ajouter les dates et montants convenus, ou reprendre explicitement
   la date originale de facture. Aucun calcul de conditions de paiement implicite.
4. Renseigner le motif, examiner les effets, cocher la confirmation puis confirmer.
   Modifier le formulaire annule la revue et la confirmation précédentes.
5. Consulter les révisions conservées. Retirer ajoute une révision vide; confirmer
   ensuite peut rétablir un planning. La facture originale ne change jamais.

L’interface réutilise Drawer, Field, Input, Button et Table de Pulsar, affiche des
cartes sur mobile et utilise les dates civiles sans déplacement de fuseau. Les
instants des opérations utilisent le fuseau utilisateur. Aide contextuelle,
documentation Finance et leçon dédiée du tutoriel de première ouverture expliquent
le parcours. Aucune réinitialisation des tutoriels et aucun nouveau bouton tutoriel.

## Contrat métier et exactitude

- Source : une `SupplierInvoice` QUALIFIED tenant-scopée, jamais un brouillon ou un
  relevé transporteur. Source, fournisseur et devise restent ceux du document figé.
- Reste = total facture moins total des `SupplierCredit` QUALIFIED liés. Les avoirs
  brouillons ne réservent ni ne réduisent ce reste. Aucun règlement n’est déduit.
- 0 à 60 échéances. Pour un reste positif : dates distinctes croissantes, réelles
  entre 1900 et 2199, jamais avant la date de facture; montants strictement positifs
  à deux décimales maximum. Somme exacte du reste. Aucun arrondi automatique.
- Reste nul : confirmation explicite d’une répartition vide. Retrait : répartition
  toujours vide, avec motif. Motif de 10 à 2 000 caractères; description ≤ 200.
- Cents `BigInt` dans Shared, Decimal/Numeric en base, chaîne sur l’API et formatage
  exact côté UI. Aucune conversion en `Number` pour les montants ou agrégats.
- Machine `canTransitionSupplierSchedule` : première confirmation; confirmation →
  nouvelle confirmation ou retrait; retrait → confirmation. Pas de retrait initial
  ni retrait successif. Le statut concerne une nouvelle révision, pas une mise à
  jour de l’ancienne ligne.

## Révisions, concurrence et reprise

`SupplierInvoiceSchedule` est append-only par writer métier : un `create`, jamais
de modification/suppression. Numéro de révision, précédente révision, devise,
montant, liste d’avoirs qualifiés, dates/montants, motif, auteur et instant sont
capturés. FK composites empêchant de relier autre tenant/facture/auteur; unicités
tenant/facture/révision, précédente révision et tenant/clé d’opération.

La revue est une transaction RepeatableRead en lecture seule. Son hash lie tenant,
acteur, source/version, précédente révision, avoirs triés et saisie normalisée.
Confirmation : utilisateur interne actif et permissions, verrou business tenant
partagé avec factures/avoirs, replay exact en premier, relecture source, machine,
validation exacte, version/hash, insertion atomique. Audit après commit; aucun
effet stock, grand livre, paiement, courrier, banque ou nouveau pouvoir d’agent.

La clé UUID est liée au tenant, à l’acteur, à la facture et au corps exact. Reprise
identique retourne la révision d’origine même si une révision plus récente existe,
sans la remplacer. Deux confirmations différentes depuis la même base ne peuvent
pas créer deux révisions. Un corps changé sous la même clé est refusé.

Le navigateur conserve la demande avant envoi sous une clé tenant/utilisateur/
facture. Réponse perdue, 403 ou conflit ne l’effacent pas. Vérifier lit le registre
de l’acteur; Reprendre renvoie strictement le même corps. Vérifier l’absence puis
refaire la revue est un choix explicite après un 404. Ce 404 est ponctuel : si
l’ancienne demande termine ensuite, version et hash empêchent une autre confirmation
depuis la même base. Stockage local corrompu/indisponible bloque la confirmation.
Ne pas supprimer arbitrairement une intention pour « réessayer ».

## Fraîcheur et synthèse

États calculés, non persistés : À planifier (aucune révision), Confirmé à jour,
À revoir, Retiré, Couvert par les avoirs, Incohérent (reste négatif).
Les avoirs qualifiés étant positifs et figés, tout nouvel avoir change le reste et
rend un planning confirmé À revoir. Anciennes échéances conservées, exclues du
prévisionnel jusqu’à nouvelle confirmation humaine. Aucun ajustement silencieux.

Liste paginée en SQL; liste, compte, groupes et classes d’échéance utilisent la même
transaction RepeatableRead et les mêmes filtres. Synthèse sur toutes les pages,
séparée par devise. Prévision uniquement CONFIRMED à jour : avant la référence, jour
de référence, 1–7 jours, 8–30 jours, au-delà. Pas de change, total interdevises ni
balance historique. Les lectures en échec retirent les anciennes données affichées.

## API et autorisations

Préfixe `/billing/supplier-schedules`, module Billing obligatoire :

- `GET /` : date de référence obligatoire, liste/synthèse filtrées.
- `GET /invoice/:id` : source financière, reste exact, dernière révision.
- `GET /invoice/:id/history` : révisions paginées, aucune clé/fingerprint exposée.
- `POST /invoice/:id/review` : revue sans mutation.
- `POST /invoice/:id/confirm` : confirmation explicite, version, token, UUID.
- `GET /requests/:operationKey` : récupération réservée à l’acteur d’origine.

Lecture `billing.supplier-invoices.read`. Revue/confirmation/récupération demandent
aussi `billing.supplier-schedules.manage`. Modèle de rôle comptable mis à jour;
les rôles existants ne gagnent pas automatiquement cette permission. Synchroniser
le catalogue lors du déploiement puis l’attribuer explicitement aux rôles voulus.
Pas d’exposition des snapshots Achats/WMS, des fichiers ou d’une clé de stockage.

Migration additive **132** : `20260927030000_supplier_invoice_schedules`.
Pas de backfill ni génération automatique d’échéanciers pour l’historique.
Application locale uniquement à `pulsar_enduser_20260921@localhost:5432`.

## Vérifications ciblées

Shared : sommes exactes, zéro, dates bissextiles/invalides, ordre, transitions et
classes. HTTP : Finance seul, lecture sans écriture, source immuable, aucune ligne
GL/paiement/stock, devises, filtres, reprise/acteurs, concurrence, avoir nouveau,
historique, retrait/rétablissement, zéro, droits/module/tenant et DTO fermés.
UI : confirmation en plusieurs dates, réponse perdue après commit, refus 403,
rechargement/reprise exacte, retrait/rétablissement, avoir nouveau, lecture seule,
erreurs retirant les totaux, liens sources et affichage bureau/390 px.

Passe finale du 2026-09-27 : **1 941 tests unitaires** (1 051 Shared, 691 API,
199 Web), **44 tests HTTP** fournisseur et **15 tests Chromium** réussis. Captures
bureau/390 px inspectées. Svelte : 0 erreur, 12 avertissements préexistants.
Builds Shared/Database/API/Web réussis. Prisma validé et régénéré; comparaison
en lecture seule : aucun écart de schéma pour la nouvelle table.

## Suite recommandée — non livrée ici

1. Décider qui tient le grand livre officiel : Pulsar natif ou logiciel externe
   autoritaire (question utilisateur posée, pas de réponse présumée).
2. Qualifier les écritures historiques. Contrat de devise de transaction/devise
   fonctionnelle, taux daté figé, Decimal exact, périodes ouvertes/fermées et droits.
   Ne pas inventer la devise d’une ancienne écriture; traiter l’ambiguïté séparément.
3. Sous-livre fournisseur distinct : dette reconnue explicitement, écritures
   atomiques équilibrées ou export confirmé/idempotent, rapprochement avec GL,
   contrepassations append-only et piste d’audit. Pas de simple statut « payable ».
4. Allocations facture/avoir/paiement, paiements partiels, écarts/change, puis balance
   âgée **réconciliée**. Ne pas renommer ce planning opérationnel en balance payable.
5. Conditions de paiement/gabarits de pourcentages, rapprochement trois pièces,
   corrections d’avoirs qualifiés, export comptable, workflows agents gouvernés :
   lots supplémentaires à spécifier, pas des capacités promises par cette page.

## Références conceptuelles consultées

- [Odoo 19 — Vendor bills](https://www.odoo.com/documentation/19.0/applications/finance/accounting/vendor_bills.html) : échéance, qualification et paiement ont des étapes distinctes.
- [Odoo 19 — Accounting](https://www.odoo.com/documentation/19.0/applications/finance/accounting.html) : double entrée et multi-devise sont des fondations comptables.

Ces références motivent la séparation des actes, pas une conformité comptable ou
fiscale de Pulsar. Aucune règle fiscale nouvelle n’est implémentée dans ce lot.
