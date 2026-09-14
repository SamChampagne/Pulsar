# Pulsar — factures et paiements, lot 3

Date : 2026-09-14. Branche : `codex/ui-billing`, depuis `de400ba`.

## Intention et périmètre

Suite des [fiches de travail](./ui-records.md). Le bureau façon iPhone et le cadre
de navigation restent inchangés. La revue de refonte privilégie le contexte de
travail, les noms lisibles, les actions explicites et les panneaux communs.

Ce lot couvre trois écrans de paiements et les deux dossiers de `/invoices`.
Il ne constitue pas une refonte de tout le module Finance.

## Livré

- Liste des paiements : vrais liens vers les dossiers, noms des parties et des
  modes de paiement, recherche, filtres accessibles et pagination locale de 25 lignes.
  Les allocations comptabilisées sont séparées par devise et encaissement/décaissement.
  Le statut serveur `SUBMITTED` se lit « Comptabilisé », pas « En attente » :
  les allocations ont déjà été appliquées aux factures et au grand livre.
- Nouveau paiement : recherche de partie côté serveur (20 résultats, sans plafond
  arbitraire aux 100 premiers clients), choix explicite des allocations, montants
  partiels, bouton Solde et une seule devise par brouillon. Changer de devise
  efface les allocations. Un lien depuis une facture ne présélectionne que celle-ci.
  Les réponses tardives ne remplacent pas la partie actuelle ; les erreurs sont
  visibles avec reprise et ne se déguisent pas en absence de factures.
- Création en deux étapes : enregistrer un brouillon, puis vérifier/comptabiliser
  depuis sa fiche. La création ne lance plus immédiatement un second POST de
  validation : un échec de validation ne provoque donc plus la création d’un autre
  paiement lors d’une nouvelle tentative depuis cette fiche.
- Fiche paiement : en-tête et navigation de dossier communs, liens vers les
  documents sources, montants déclaré/alloué distincts, effet comptable expliqué.
  Le brouillon est modifiable dans un panneau avec conservation des saisies après
  erreur et confirmation avant abandon. Validation et annulation sont confirmées,
  gardées contre les clics concurrents et réservées à la permission de gestion.
- Factures transporteurs et relevés clients : dossiers dans des panneaux animés
  avec défilement/focus/Échap communs. Les tables ne s’allongent plus à l’ouverture
  d’une fiche. Liens vers chargements/ordres existants et vers la préparation du
  paiement avec partie et facture présélectionnées. Les URL `?invoice=…` et
  `?statement=…` résolvent aussi un dossier absent de la première page de résultats.
  Les saisies de rapprochement sont protégées à la fermeture. Les anciennes
  actions de paiement intégral restent disponibles, mais leur mode par défaut
  et leur effet comptable sont expliqués avant confirmation.

## Contrat API et invariants

Extension additive, sans nouvel endpoint ni migration :

- `GET /billing/payments` et `GET /billing/payments/:id` ajoutent
  `party: { id, name } | null`.
- Le détail ajoute `allocations[].target: { id, invoiceNumber } | null`.
- Les relations polymorphes sont résolues par famille et **tenantId**, par lots
  (pas une requête HTTP supplémentaire par cellule). Les projections sont explicites.
- Les endpoints de liste conservent leur contrat **tableau brut** ;
  `modeOfPayment` est un objet, pas une chaîne.
- Aucune modification des transitions, écritures/reversals, plafonds, audits,
  snapshots, permissions serveur, montants, taxes ou gouvernance des agents.
  La validation serveur reste autoritaire. Les contrôles de formulaire ne la remplacent pas.

Le grand livre comptabilise seulement les allocations. Un éventuel montant déclaré
non alloué est signalé explicitement ; il n’est ni comptabilisé ni présenté comme
un crédit client. Ce comportement existant n’est pas modifié.

## Vérification

- API : 4 nouveaux tests de projections (isolation tenant, distinction client/
  transporteur et facture/relevé, projections explicites, relations indisponibles).
- Web : 34 tests unitaires passent, dont 3 sur montants/devise/liens.
- Comptabilité : les 15 tests de `payments.e2e-spec.ts` passent sur
  `pulsar_relaunch_test_20260913` : partiel, solde complet, annulation, grand livre
  équilibré, isolation, sur-allocation et incohérence de devise. Le runner a
  signalé temporairement des handles ouverts avant de sortir avec le code 0.
- Types API et web : 0 erreur. Les 12 avertissements Svelte restants sont dans
  les pages Sites, CRM inbox et CustomFieldInputs, hors de ce lot.
- Build API et build SPA de production réussis.
- Tests navigateur : 15 nouveaux scénarios couvrent sélection/devise, brouillon,
  validation échouée puis reprise sur le même identifiant, annulation refusée,
  modifications conservées, recherche serveur, réponses tardives, liens profonds,
  invariance de largeur des panneaux et les quatre écrans à 390 px.
  Les mutations de cette suite sont interceptées ; elles ne valent pas preuve de
  l’intégration comptable, couverte séparément par les tests API ci-dessus.
- Passe consolidée de non-régression : **101 tests UI passent** (1,3 min, 2 workers),
  incluant les 15 nouveaux scénarios et les 86 tests des lots précédents.
  Captures inspectées à 390 px pour la préparation et le panneau facture, ainsi
  que la liste réelle dans le navigateur intégré. Deux assertions initiales
  visaient des sélecteurs trop stricts (label du select et puce du badge) ; elles
  ont été corrigées pour viser leur rôle/contexte, sans assouplir le comportement testé.

Docker et les services locaux ont été relancés ; l’API tourne sur 3100 et le web
sur 5173, sur la base locale de relance. `.env` n’a pas été modifié. Aucun transfert
bancaire, courriel ou SMS externe, aucun déploiement OVH et aucun push GitHub.

## Limites et suite proposée

1. Poursuivre les fiches d’audit transporteur, puis les liens paiement → écritures
   précises du grand livre et rapprochement bancaire (le lien actuel ouvre le grand livre).
2. Reprendre la préparation en masse des factures/relevés : ses sélecteurs historiques
   restent limités à 100 entrées, certains libellés sont encore en anglais et la liste
   transporteur ne charge que les 50 premiers dossiers. Ne pas présenter ses compteurs
   comme des totaux exhaustifs. Prévoir pagination/recherche serveur de ces listes.
3. L’édition d’un paiement corrige ses allocations existantes ; l’ajout d’une autre
   facture et le changement de partie/devise/mode après création restent à concevoir.
   Les soldes sont revalidés lors de la comptabilisation, pas garantis par l’éditeur.
4. Un POST de création dont la réponse est perdue reste un résultat incertain :
   vérifier la liste avant de recommencer. La séparation création/validation et
   les gardes UI ne remplacent pas une clé d’idempotence serveur.
5. La confirmation de fermeture protège les panneaux, pas une fermeture d’onglet
   ou un rechargement. Pas de persistance universelle des brouillons dans ce lot.
6. Durcissement API à traiter séparément avant un usage comptable exigeant : le
   service existant vérifie la famille de cible et l’appartenance au tenant, mais
   ne compare pas explicitement la partie du paiement à la partie de chaque facture
   lors de la soumission, ni `type` à `partyType` à la création. Le nouveau formulaire
   construit des combinaisons cohérentes via les factures ouvertes de la partie ;
   cela ne constitue pas une garantie contre un appel API direct. Ce lot n’a pas
   changé ces règles métier ni ajouté des garde-fous serveur sur ce point.

```sh
pnpm --filter @pulsar/api typecheck
pnpm --filter @pulsar/api test -- --runInBand payments-display.spec.ts
pnpm --filter @pulsar/api test:e2e -- payments.e2e-spec.ts
pnpm --filter @pulsar/web typecheck
pnpm --filter @pulsar/web build
pnpm --filter @pulsar/web test
pnpm --filter @pulsar/web test:e2e billing-screens.spec.ts record-screens.spec.ts fulfillment.spec.ts screen-redesign.spec.ts screen-surfaces.spec.ts workspace.spec.ts crm-pipelines.spec.ts crm-sequences.spec.ts journeys.spec.ts responsive.spec.ts loads-list.spec.ts control-center.spec.ts --workers=2 --reporter=line
```
