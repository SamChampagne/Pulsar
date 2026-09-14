# Dossiers financiers connectés — lot 5

Date : 2026-09-14. Branche : `codex/finance-connected-flow`, depuis `codex/ui-finance-audit`.

## Résultat et usage

Le parcours **audit transporteur → facture comptable → paiement → rapprochement bancaire**
est navigable sans recopier des identifiants. Le bureau des apps et le socle UI restent inchangés.

1. Ouvrir un audit rapproché/résolu, puis la section **Dossier financier**.
2. **Associer une facture existante** ouvre un panneau animé avec recherche, pagination
   et motifs d’incompatibilité. L’association est confirmée explicitement.
3. La facture s’ouvre dans le panneau Finance existant; elle offre un retour vers l’audit.
   **Préparer le paiement** conserve le transporteur et la facture cible.
4. Le paiement conserve son parcours brouillon → comptabilisation et son lien vers le journal.
   Le bouton Banque ouvre le rapprochement avec le paiement en contexte.
5. Sélectionner un mouvement compatible, vérifier la confirmation, puis rapprocher.
   Le rapprochement peut être retiré; cela ne contre-passe pas la comptabilisation.

Le compte bancaire est choisi automatiquement seulement si le paiement possède déjà un
rapprochement ou s’il n’existe qu’un compte de même devise et compte GL. Sinon, le choix reste humain.
Les réponses tardives d’un compte précédent ne peuvent plus remplacer la sélection courante.
Les onglets Banque utilisent le composant commun accessible au clavier. Les erreurs restent locales.

**Aucun transfert bancaire, connecteur bancaire externe, facture automatique ou nouvelle autonomie
d’agent n’est ajouté.** Le statut d’audit « réglée (suivi) » reste documentaire : il n’est pas
synchronisé automatiquement avec la facture ou le paiement.

## Contrat documentaire

- `IncomingCarrierInvoice.accountingInvoiceId` est facultatif, un à un. La FK composite
  `(tenantId, accountingInvoiceId) → Invoice(tenantId, id)` impose l’isolation en base.
- La facture doit être APPROVED/PAID; l’audit MATCHED/RESOLVED/PAID.
- Même transporteur, même devise, exactement les mêmes chargements, tous rapprochés une seule fois.
- Le net comptable (`totalAmount - taxAmount`) égale le montant retenu : `matchedTotal`
  par défaut/KEEP_EXPECTED, `chargedTotal` pour ACCEPT_CHARGED. Aucune copie/recalcul de montant.
  Les taxes restent celles de la facture comptable; le coût figé du chargement est inchangé.
- Verrous sur audit puis facture, unicité et audit de mutation. Répéter la même association
  est sans effet; une autre association sur un dossier déjà lié renvoie 409.
- Pas de dissociation/réaffectation dans ce lot. Une correction documentaire doit faire l’objet
  d’un futur parcours audité; ne pas contourner les contrôles par un PATCH générique.

API (préfixe `/api/v1`) :

| Endpoint | Droits et réponse |
| --- | --- |
| `GET /freight-audit/incoming-invoices/:id/accounting` | Module Billing + lecture audit, factures, paiements ET grand livre. Retourne facture, allocations des paiements à cette facture, rapprochement éventuel et candidats paginés (`page`, `pageSize`, `search`). |
| `POST /freight-audit/incoming-invoices/:id/link-invoice` | Gestion audit + lecture factures; `{ invoiceId }`. Renvoie uniquement `accountingInvoiceId`. |
| `GET /billing/invoices` et `/:id` | Ajout du lien inverse minimal `incomingAudit: { id }`. Le lien UI exige la lecture audit. |
| `GET /billing/bank-transactions?paymentId=…` | Filtre exact, toujours tenant-scopé; conserve le droit de lecture grand livre existant. |

Les candidats non admissibles restent visibles avec un motif, pour éviter une liste vide
incompréhensible. Le serveur revérifie l’admissibilité lors de l’association.

## Contrat de rapprochement bancaire

- Un mouvement = un paiement SUBMITTED, entièrement alloué, non déjà rapproché.
- Même devise et compte GL du mode de paiement; montant signé identique : PAY négatif,
  RECEIVE positif. Contrôle pur partagé `bankMatchError`, réutilisé côté UI et API.
- L’API contrôle aussi la véritable écriture d’origine du paiement (`sourceKind = null`) :
  une seule écriture, dont la somme débit − crédit du compte bancaire égale le mouvement.
  Une simple configuration de mode de paiement ne suffit pas à justifier le rapprochement.
- Transitions via `canTransitionBankTxn`; ordre de verrouillage paiement → mouvement
  partagé avec le retrait et l’annulation. Claims conditionnels dans la même transaction.
- Répéter le rapprochement identique ne duplique ni journal ni audit. Un paiement ne peut
  être réclamé par deux mouvements simultanés.
- L’annulation d’un paiement déjà rapproché est refusée, y compris côté API : retirer le
  rapprochement d’abord. L’annulation conserve ensuite la contre-écriture existante.
- Devise et compte GL d’un compte bancaire sont figés dès son premier mouvement.
  Supprimer un compte contenant des mouvements est refusé; son nom reste modifiable.
- Créations/imports de mouvements ajoutés au décorateur d’audit standard.

## Migration et environnement

Migration additive `20260914180000_freight_accounting_link` : colonne nullable, index uniques,
FK composite. Aucun backfill automatique ni suppression de données. Appliquée aux bases locales
de développement `pulsar_relaunch_20260913` et de test `pulsar_relaunch_test_20260913`.

Pour un autre environnement : sauvegarder la base, appliquer les migrations déployées,
régénérer Prisma puis reconstruire shared/database/API/web avant de relancer. L’API de ce lot
nécessite la migration; ne pas déployer seulement le front. Sur Windows, arrêter le processus
API avant `prisma generate` pour libérer le DLL du moteur Prisma.

API locale reconstruite sur 3100, web sur 5173. `.env` conservé. Aucun push ni déploiement OVH.

## Vérification

- 67 tests HTTP réussis sur la base de test séparée : 17 nouveaux scénarios de dossier financier,
  24 paiements, 10 banque et 16 Freight Audit (dont gouvernance agent existante).
- 17 tests shared Banque; 34 tests unitaires web; 8 tests unitaires API ciblés réussis.
- 31 tests navigateur Finance ciblés réussis, dont 7 nouveaux; écritures financières interceptées.
  Captures ordinateur et téléphone inspectées : association en panneau, motifs, contexte bancaire,
  confirmations, refus API, retrait et annulation protégée, changement de compte à réponse tardive.
- Régression élargie : **117 tests navigateur réussis** en 1,2 minute, incluant les lots UI
  précédents, CRM/TMS, bureau conservé, mobile/tablette et les 7 nouveaux scénarios.
- Builds API/web et typechecks API/web réussis. 12 avertissements Svelte préexistants dans
  5 fichiers hors de ce périmètre restent présents.
- Les fixtures du nouveau test API utilisent un tenant unique par exécution dans la base de test;
  elles sont conservées pour diagnostic, sans connexion bancaire réelle ni session Hermes.
- Jest signale des handles ouverts après les suites HTTP (comportement existant); les suites
  finissent avec succès. Ce lot ne prétend pas résoudre le cycle de vie de tous les workers.

Commandes ciblées :

```sh
pnpm --filter @pulsar/shared test banking.spec.ts
pnpm --filter @pulsar/api test:e2e finance-connected-flow.e2e-spec.ts payments.e2e-spec.ts banking.e2e-spec.ts phase16-freight-audit.e2e-spec.ts
pnpm --filter @pulsar/web test:e2e finance-connected-flow.spec.ts finance-audit.spec.ts billing-screens.spec.ts --workers=2 --reporter=line
```

## Limites et prochaine étape

1. Import CSV encore simple et non idempotent : importer deux fois crée deux mouvements.
   Priorité suivante : prévisualisation, validation des dates/colonnes et dédoublonnage serveur,
   avant tout connecteur bancaire. Les formulaires manuels/CSV existants ne sont pas tous refondus.
2. Rapprochement volontairement un à un : pas de frais, avance non allouée, FX, paiement groupé
   ni rapprochement partiel. Ne pas retirer les contrôles pour « faire passer » ces cas.
3. Plusieurs audits pour une facture, plusieurs lignes d’audit pour un chargement et dossiers
   partiellement rapprochés ne sont pas associables dans ce lot. Concevoir un mapping de lignes
   explicite si ces usages deviennent nécessaires.
4. Revue d’atomicité du Freight Audit historique et rapprochement de factures encore à faire
   (claim d’en-tête vérifié après transaction de lignes); aucun de ces chemins n’est réécrit ici.
5. Le grand livre reste sans devise fonctionnelle/FX. Ce lot n’est pas une certification de
   comptabilité de production multi-devises. Pagination serveur du relevé et des paiements
   du dossier à prévoir pour les grands volumes.
6. Aucun outil agent nouveau. Toute future proposition d’association/rapprochement doit passer
   par le registre d’outils, les permissions, les plafonds et `ProposedAction`, jamais directement
   par un contrôleur. Commencer par des suggestions explicables et confirmées humainement.
