# Billing configurable v1 (arc C) — design

> Spec de design. **Arc C** du programme « plateforme tressée » (séquence A → B → C : *flux visible →
> tressage approfondi → modules configurables*). Arc C = rejouer le patron du **socle TMS configurable**
> (règles de processus + champs personnalisés) sur les autres modules ; ce premier sous-projet le fait
> sur **Billing**. Les suivants (WMS/Fleet/Yard/Procurement) rejoueront la même recette.

## 0. Dépendance de branche
La moitié « champs personnalisés » réutilise l'infrastructure générique livrée par le socle TMS
(`tms-configurable-socle`, non encore mergé) : table `CustomFieldDefinition`, colonnes `customData`,
`validateCustomFields`/`validateDefinitions` (`@pulsar/shared`), composant `<CustomFieldInputs>`, le
type de réglage **`string`**, et le mécanisme de **préfixes de séquence configurables**
(`SequencesService.prefixFor` + `PREFIX_SETTING`). **Cette branche part de `tms-configurable-socle`**
(elle rebasera sur `main` quand le socle mergera).

## 1. Intention
Rendre Billing adaptable par tenant, défauts = comportement actuel exact. Aucun nouveau statut métier,
aucune modification des state machines (`invoice`/`customer-invoice`/`freight-audit.workflow`) — règle 2 ;
les gates sont pilotés par réglages dans les transitions existantes. Tenant isolation (règle 1), audit
(règle 6/14), numéros via `SequencesService` (règle 8).

## 2. A — Règles de processus configurables (réglages `billing`)
Ajoutées au catalogue `billing` (en plus de `tolerancePct`/`toleranceAbsolute` existants).

| Réglage | Type | Défaut | Effet | Point d'application |
| --- | --- | --- | --- | --- |
| `autoSendOnApproval` | boolean | `false` | À l'approbation d'un relevé client : si le client a un email, envoi auto + transition `SENT` (réutilise `CustomerInvoicesService.send`, best-effort) ; sinon reste `APPROVED` sans erreur. | `customer-invoices.service.approve` |
| `toleranceMode` | enum `MAX`/`MIN` | `MAX` | Seuil de rapprochement = `max()` (actuel) ou `min()` de (absolu, % du total). | `evaluateReconciliation` (`@pulsar/shared/billing/reconciliation`, +param `mode`) — consommé par `invoices.service.reconcile` ET `freight-audit.service.audit` |
| `invoiceNumberPrefix` | string | `INV` | Préfixe du numéro de facture transporteur. | `SequencesService` (clé `invoice` ajoutée à `PREFIX_SETTING`) |
| `customerInvoiceNumberPrefix` | string | `CINV` | Préfixe du numéro de relevé client. | `SequencesService` (clé `customer-invoice`) |
| `defaultCurrency` | string | `CAD` | Devise par défaut à la création quand aucune n'est fournie. | `invoices.service`/`freight-audit.service`/`customer-invoices.service` (là où `'CAD'` est codé en dur) |

Notes :
- `toleranceMode` : étendre la fonction pure `evaluateReconciliation` d'un paramètre `mode: 'MAX' | 'MIN'`
  (défaut `'MAX'` = comportement actuel). Le commentaire existant dans `reconciliation.ts` signale déjà
  ce knob.
- Préfixes : pattern `^[A-Z0-9]{1,6}$`, `maxLength: 6` (comme TMS) ; le compteur reste indexé sur la clé
  de séquence, jamais sur le préfixe (règle 8) — mécanisme `prefixFor` déjà en place, on ajoute juste
  `invoice` et `customer-invoice` à `PREFIX_SETTING` (mappés sur les nouveaux réglages) et on lit le
  module `'billing'` au lieu de `'transportation'` pour ces clés.
- `defaultCurrency` : appliqué uniquement quand le DTO ne fournit pas de devise ; n'altère jamais une
  facture existante. Validé `^[A-Z]{3}$`, `maxLength: 3`.

## 3. B — Champs personnalisés Billing
Réutilise l'infra générique (paramétrée par `module` + `entityType`).
- **Enum `CustomFieldEntity`** (shared + miroir Prisma, règle 3) += `INCOMING_CARRIER_INVOICE`, `CUSTOMER_INVOICE`.
- **Colonnes** `customData Json?` sur `IncomingCarrierInvoice` et `CustomerInvoice`.
- **API** : contrôleur `billing/custom-fields` (gated `@RequireModule(MODULE_KEYS.BILLING)` + `core.modules.read|manage`),
  réutilisant `CustomFieldsService` (déjà paramétré par `module`/`entityType` — on passe `module: 'billing'`).
  Le service est généralisable ; si son `MODULE` est codé en dur à `'transportation'`, on le paramètre.
- **Saisie & validation** : le DTO d'intake freight-audit (`CreateIncomingInvoiceDto`) accepte
  `customData?: Record<string, unknown>`, validé via `validateCustomFields` (entityType `INCOMING_CARRIER_INVOICE`)
  avant persistance ; projeté dans les GET. Les relevés client (`CustomerInvoice`) sont **auto-générés**
  (`createDrafts`) — pas de point de saisie utilisateur : `CUSTOMER_INVOICE` est donc **display/API** en v1
  (les définitions s'affichent ; les valeurs n'ont pas d'entrée UI, comme `LOAD` au TMS). On câble quand
  même la colonne + l'enum pour que la définition et l'affichage soient prêts.
- **Web** : éditeur de définitions sur la page Configuration du module Billing (réutilise
  `<CustomFieldsEditor>` du socle, sélecteur d'`entityType` Billing) ; `<CustomFieldInputs>` branché sur le
  formulaire d'intake freight-audit ; affichage des valeurs en détail/list freight-audit.

## 4. Migration & permissions
- **1 migration** : `CustomFieldEntity` += 2 valeurs + `customData Json?` sur `IncomingCarrierInvoice` et
  `CustomerInvoice`. Réglages = pas de migration (stockés JSON sur `TenantModule.settings`).
- **Aucune nouvelle permission** : config (réglages + définitions) sous `core.modules.read|manage` ;
  valeurs sous les permissions `billing.*` existantes.

## 5. Conformité CLAUDE.md
Règle 1 (isolation sur définitions/valeurs), règle 2 (aucun statut/state-machine touché — gates par
réglage dans les transitions existantes), règle 3 (enum mirroré), règle 8 (compteur sur la clé, pas le
préfixe), règle 14 (config auditée), règle 16 préservée (le `priceDetail`/coût figé n'est jamais
recalculé ; `defaultCurrency` n'affecte que la création). `customData` toujours validé par
`validateCustomFields` avant persistance (cohérent règle 35 du socle TMS).

## 6. Tests
- **Unit `@pulsar/shared`** : `evaluateReconciliation` en mode `MIN` vs `MAX` (défaut `MAX` inchangé) ;
  résolution des nouveaux descripteurs `billing` (défauts = comportement actuel) ; validation `string`
  des préfixes + `defaultCurrency`.
- **e2e `billing-configurable`** (DB seedée) :
  - `autoSendOnApproval=true` → approuver un relevé client (client avec email) → statut `SENT` (email mock) ;
    sans email → reste `APPROVED` sans erreur.
  - `toleranceMode=MIN` → un écart qui passait sous `MAX` est désormais flaggé/disputé (seuil resserré).
  - Préfixe : `invoiceNumberPrefix='FAC'` → prochaine facture transporteur commence par `FAC-`, compteur
    non réinitialisé ; idem `customerInvoiceNumberPrefix`.
  - `defaultCurrency='USD'` → création sans devise → facture en USD.
  - Champs perso : définir un champ requis sur `INCOMING_CARRIER_INVOICE` → intake sans valeur = 400 →
    valeur hors options = 400 → valeur valide = 201 et `customData` projeté ; isolation tenant (défs d'un
    tenant B invisibles).
  - Défauts : sans réglage ni champ défini, les parcours billing existants restent verts (rétro-compat).

## 7. Découpage d'implémentation (aperçu — détaillé dans le plan)
1. `@pulsar/shared` : descripteurs `billing` (`autoSendOnApproval`, `toleranceMode`, 2 préfixes,
   `defaultCurrency`) + param `mode` sur `evaluateReconciliation` + enum `CustomFieldEntity` += 2 ; tests. Rebuild.
2. Migration : enum + colonnes `customData` (IncomingCarrierInvoice, CustomerInvoice).
3. API règles : `toleranceMode` dans reconcile/audit ; `autoSendOnApproval` dans approve ; `defaultCurrency`
   aux créations ; préfixes (`PREFIX_SETTING` += invoice/customer-invoice lisant le module `billing`).
4. API champs perso : généraliser `CustomFieldsService` au module ; contrôleur `billing/custom-fields` ;
   `customData` accepté/validé/projeté sur l'intake freight-audit (+ colonne CustomerInvoice prête).
5. Web : entrée Configuration Billing + `<CustomFieldsEditor>` (entités Billing) ; `<CustomFieldInputs>`
   sur l'intake freight-audit ; affichage des valeurs.
6. e2e `billing-configurable` + vérification navigateur + docs.

## 8. Hors périmètre (YAGNI / backlog)
`autoApproveBelowAmount`, `roundingMode`, `autoResolutionCode` (disputes), `recoveryCalculation`,
`defaultCurrency` multi-devises avec conversion — backlog (plus risqués/nuancés). Pas de champs perso
sur la facture transporteur auto-générée (`Invoice`, pas de formulaire de saisie). La recette de ce
spec est le **gabarit** pour WMS/Fleet/Yard/Procurement (sous-projets arc C suivants).
