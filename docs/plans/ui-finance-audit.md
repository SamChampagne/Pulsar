# Pulsar — audit transporteur et traçabilité comptable, lot 4

Date : 2026-09-14. Branche : `codex/ui-finance-audit`, depuis `5091b42`.

## Périmètre livré

Suite de [Factures et paiements, lot 3](./ui-billing.md). Le bureau d’applications
façon iPhone, le cadre de navigation et les autres modules sont conservés.
La refonte réutilise les composants existants : panneaux animés, confirmations,
retour du focus, navigation de sections, onglets clavier et erreurs locales.

- `/billing/freight-audit` : liste en français, recherche et filtre de statut sur
  les 50 derniers dossiers, portée des compteurs explicite, économies séparées par
  devise. Une panne des économies ou des champs personnalisés ne masque plus la liste.
- Saisie en panneau : choix du transporteur par recherche, références de chargement
  expliquées, devise normalisée en majuscules, montants décimaux, champs personnalisés
  conservés. Les erreurs API ne détruisent pas la saisie; abandon confirmé et double
  envoi bloqué. Si les définitions des champs ne peuvent être chargées, la saisie est
  suspendue. Les droits existants sur le catalogue et les transporteurs restent requis.
- `/billing/freight-audit/[id]` : synthèse, rapprochement ligne/chargement, liens TMS
  selon droits et module actif, suivi du litige et dates. Les identifiants bruts ne
  remplacent plus les références métier. Litige/résolution en panneaux, résolution
  confirmée, action « Marquer réglée » explicitement limitée au suivi d’audit.
- `/billing/ledger` : onglets accessibles, filtres serveur compte/date/source,
  pagination, retour vers paiement/facture/relevé et identification des contrepassations.
  Erreur et absence de résultats sont distinguées dans le journal. Saisie manuelle
  en panneau, équilibrage visible, confirmation avant comptabilisation, erreurs
  conservées. Une écriture manuelle n’est jamais attribuée à la source filtrée.
- `/billing/payments/[id]` : accès au journal **de ce paiement**, y compris sa
  contrepassation, au lieu d’un lien vers le grand livre non filtré.

## Contrôle serveur des paiements

Le défaut identifié au lot 3 est corrigé. Un utilisateur autorisé du tenant ne
pouvait pas auparavant être empêché de choisir la facture d’une autre partie du
même tenant par un appel API direct.

1. Création : `RECEIVE ↔ CUSTOMER` et `PAY ↔ CARRIER`, famille de facture cohérente,
   allocations non vides, positives et sans doublon. Chaque cible est vérifiée via
   `OwnershipService`, puis comparée à la partie du paiement. Les factures inconnues
   et hors tenant sont refusées avant création du paiement.
2. Édition : verrou de ligne PostgreSQL sur le paiement, lecture fraîche des
   allocations dans la transaction, validation des cibles avant remplacement,
   opérations scopées tenant. Seuls les brouillons sont modifiables. Une tentative
   de changer type, partie, devise ou mode est explicitement refusée au lieu d’être
   silencieusement ignorée; renvoyer leur valeur inchangée reste accepté.
3. Comptabilisation : même verrou, mêmes allocations fraîches pour les soldes et
   le journal. Revalidation de la partie, famille, direction, devise, statut et
   solde, y compris pour les anciens brouillons. Une facture doit être approuvée
   (ou envoyée côté client), même pour un paiement partiel. Les claims de facture
   gardent montant payé, total, partie, statut, devise et tenant observés.
4. Une erreur annule la transaction entière : statut du paiement, soldes des
   factures et écriture GL. Les transitions et audits existants sont conservés.

Les contrôles de devise et de dépassement du solde d’une facture restent à la
comptabilisation, comme auparavant. Un brouillon peut donc nécessiter correction.
Pas de migration ni de changement des plafonds, policies ou outils d’agents.

## Contrats API additifs

- `GET /billing/ledger/journal?sourceType=payment&sourceId=<id>` accepte les filtres
  `sourceType` et `sourceId`, combinables aux filtres compte/date et à la pagination.
  Le tenant vient toujours de l’utilisateur authentifié. Le total utilise le même filtre.
- `GET /freight-audit/savings` ajoute `byCurrency: [{ currency, recovered }]`.
  L’écran utilise exclusivement ces montants par devise. Les champs historiques
  `tenantTotal` et `byAgent` sont maintenus pour compatibilité, sans modification
  des consommateurs agents; ils ne constituent pas des agrégats multi-devises fiables.

## Vérification et environnement

- Tests API paiements : 24 scénarios réussis sur `pulsar_relaunch_test_20260913`,
  dont mauvais client/transporteur, autre tenant, cible absente, doublon, mauvaise
  direction, édition atomique, brouillon ancien invalide, paiement partiel non
  approuvé, édition/soumission concurrentes et filtrage des écritures par source.
- Tests unitaires API ciblés : 8 réussis (projections des paiements, rapprochement
  et économies par devise). Tests unitaires web : 34 réussis.
- Nouveaux tests navigateur : 9 scénarios, écritures interceptées; aucun paiement
  réel ni courriel/SMS n’est envoyé. Captures desktop/mobile inspectées et bouton
  comptable mobile corrigé après cette inspection.
- Régression navigateur complète des lots UI et parcours existants : **110 tests
  réussis** en 1,6 minute, incluant les 9 nouveaux scénarios.
- Builds API et web réussis. Typechecks API et web réussis; le web conserve
  12 avertissements préexistants dans 5 fichiers hors périmètre.
- API locale reconstruite et relancée sur 3100; web sur 5173. Lecture authentifiée
  des économies et d’un journal filtré vérifiée. `.env` inchangé, aucune migration,
  aucun déploiement OVH, aucun push GitHub dans ce lot.

Commandes principales :

```sh
pnpm --filter @pulsar/api typecheck
pnpm --filter @pulsar/api build
pnpm --filter @pulsar/api test --runInBand payments-display.spec.ts freight-audit.service.spec.ts
pnpm --filter @pulsar/api test:e2e payments.e2e-spec.ts
pnpm --filter @pulsar/web typecheck
pnpm --filter @pulsar/web build
pnpm --filter @pulsar/web test
pnpm --filter @pulsar/web test:e2e finance-audit.spec.ts billing-screens.spec.ts record-screens.spec.ts fulfillment.spec.ts screen-redesign.spec.ts screen-surfaces.spec.ts workspace.spec.ts crm-pipelines.spec.ts crm-sequences.spec.ts journeys.spec.ts responsive.spec.ts loads-list.spec.ts control-center.spec.ts --workers=2 --reporter=line
```

## Limites et prochain lot recommandé

1. **Audit ≠ comptabilisation.** `IncomingCarrierInvoice` et `Invoice` sont deux
   entités distinctes, sans association comptable automatique. `markPaid` n’enregistre
   qu’un état de suivi. Prévoir un rapprochement explicite et idempotent vers la facture
   comptable avant de proposer un parcours audit → facture → paiement → banque.
   Ne pas créer une seconde facture automatiquement à partir d’un simple libellé.
2. **Multi-devises du grand livre à concevoir.** `JournalEntry`/`JournalLine` ne
   portent actuellement ni devise fonctionnelle ni taux de change. La balance ne
   doit pas être interprétée comme une consolidation multi-devises. Ce lot ne valide
   pas Pulsar comme système comptable de production complet.
3. Généraliser `byCurrency` aux anciens consommateurs des économies (dont agents),
   puis déprécier les agrégats historiques non ventilés sans casser leurs contrats.
4. Recherche/pagination serveur des audits au-delà de 50 dossiers; sélection de
   chargements assistée plutôt que référence manuelle; droits de lecture des
   catalogues à examiner pour un rôle spécialisé facturation sans administration.
5. Revue dédiée de l’atomicité du rapprochement Freight Audit : le service historique
   écrit les lignes dans une transaction puis vérifie le résultat du claim d’en-tête
   après retour de transaction. Ce chemin n’a pas été changé par cette refonte.
6. Idempotence serveur des créations, persistance des saisies après rechargement et
   annulation de navigation avec formulaire modifié restent à traiter. Une réponse
   perdue au POST impose de vérifier la liste avant de recommencer.

Suite réalisée dans le [lot 5 — dossiers financiers connectés](./finance-connected-flow.md) :
association explicite à une facture existante et rapprochement bancaire contrôlé.
Les limites historiques ci-dessus restent valables sauf le manque d’association documentaire.
