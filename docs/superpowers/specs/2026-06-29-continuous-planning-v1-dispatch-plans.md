# Spec — Continuous Planning v1 : Dispatch Plans (Phase 17, tranche 1)

> Première tranche du « verrou architectural » §19.5 / Phase 17 de la roadmap Agent OS.
> But : introduire des **plans de dispatch versionnés et gouvernés** (`PlanProposal`/`PlanCommit`)
> pour le transport — proposer un plan, voir son **diff** vs l'état courant, puis le **committer**
> atomiquement. Le commit humain est la porte de gouvernance.

## Pourquoi (bénéfice utilisateur démontrable)

Aujourd'hui le dispatch est immédiat : `POST /loads/consolidate` applique tout de suite. Il n'existe
aucune notion de **plan proposé, revu, puis validé**. Cette tranche apporte :
- un **plan versionné** (historique des plans, qui a proposé/committé, quand) ;
- un **diff/preview** avant d'agir (quels shipments, encore planifiables ?) ;
- un **commit gouverné** (porte humaine) qui réutilise la consolidation atomique existante.

C'est le substrat sur lequel **l'agent dispatcher proposera des plans complets** (v2) via le même
contrat de gouvernance, et sur lequel viendront les moteurs (greedy/rate-shopping/VROOM) plus tard.

## Périmètre v1 (volontairement borné)

- **DANS** : modèle versionné `DispatchPlan` + items ; cycle DRAFT→PROPOSED→COMMITTED/DISCARDED ;
  diff (preview lecture) ; commit qui **réutilise `LoadsService.consolidate`** par item ; UI liste+détail.
- **HORS v1 (→ v2)** : agent qui propose un plan (tool `propose_dispatch_plan` MUTATING via
  `ProposedAction`) ; moteurs automatiques (greedy/rate-shopping/VROOM) ; mutation d'ordres confirmés ;
  ré-affectation/dé-consolidation dans un plan (v1 = consolidations seulement).

## Modèle de données (1 migration)

```prisma
enum DispatchPlanStatus { DRAFT PROPOSED COMMITTED DISCARDED }

model DispatchPlan {
  id            String             @id @default(cuid())
  tenantId      String
  planNumber    String                                  // séquence 'dispatch-plan' → PLAN-0001
  status        DispatchPlanStatus @default(DRAFT)
  engine        String             @default("MANUAL")    // MANUAL | (greedy/rate-shopping = v2)
  note          String?
  createdById   String?
  committedById String?
  committedAt   DateTime?
  createdAt     DateTime           @default(now())
  updatedAt     DateTime           @updatedAt
  tenant        Tenant             @relation(fields: [tenantId], references: [id])
  items         DispatchPlanItem[]
  @@index([tenantId, status])
  @@index([tenantId, createdAt])
  @@map("dispatch_plans")
}

model DispatchPlanItem {
  id           String   @id @default(cuid())
  tenantId     String
  planId       String
  shipmentIds  String[]                 // shipments à consolider en UN load
  resultLoadId String?                  // rempli au commit (load créé)
  error        String?                  // rempli si l'item a échoué au commit (best-effort)
  createdAt    DateTime @default(now())
  plan         DispatchPlan @relation(fields: [planId], references: [id], onDelete: Cascade)
  @@index([tenantId, planId])
  @@map("dispatch_plan_items")
}
```
+ relation `dispatchPlans DispatchPlan[]` sur `Tenant`. Enum miroir dans `@pulsar/shared`.

## Machine d'états (règle 2) — `@pulsar/shared`

`canTransitionDispatchPlan(from, to)` :
- DRAFT → PROPOSED, DISCARDED
- PROPOSED → COMMITTED, DISCARDED
- COMMITTED / DISCARDED = terminaux

Pur + testé (`dispatch-plan.spec.ts`).

## Service `DispatchPlansService` (transport)

- `create(tenantId, userId, { items, engine?, note? })` → DRAFT. Valide ≥1 item, chaque item ≥1
  shipmentId, **ownership** des shipments (`OwnershipService`/findMany scoping, règle 9). Numéro via
  `SequencesService.nextNumber(tenantId,'dispatch-plan')` (règle 8).
- `list(tenantId, paginated)` / `get(tenantId, id)` (items inclus).
- `diff(tenantId, id)` (lecture) : pour chaque item, état courant de ses shipments
  (`found`/`PENDING`/`alreadyAssigned`) → `committable: boolean` par shipment + par item. Aucun effet.
- `propose(tenantId,userId,id)` : DRAFT→PROPOSED via `canTransitionDispatchPlan` + claim
  `updateMany({id,status:DRAFT}→PROPOSED)` (TOCTOU). Audité.
- `commit(tenantId,userId,id)` : **claim atomique** `updateMany({id,status:PROPOSED}→COMMITTED)`
  (anti double-commit, race-safe). Puis, par item, appelle `loadsService.consolidate(tenantId,userId,
  item.shipmentIds)` ; succès → `resultLoadId` ; échec (shipment plus PENDING/déjà assigné) →
  `error` (best-effort, pas de rollback global — chaque consolidate est atomique en soi). Renseigne
  `committedAt/committedById`. Audité (`@Audit`/`AuditLogsService.log`, règle 6). Renvoie le plan.
- `discard(tenantId,userId,id)` : →DISCARDED (claim-guardé). Audité.

Réutilise **intégralement** `LoadsService.consolidate` (règles 8/9/11/18 déjà couvertes) — pas de
réimplémentation de la consolidation.

## API (gated `@RequireModule(MODULE_KEYS.TRANSPORTATION)`, tenant-scopée règle 1)

- `GET  /transportation/dispatch-plans`            (`transportation.planning.read`) → Paginated
- `GET  /transportation/dispatch-plans/:id`        (read) → plan + items
- `GET  /transportation/dispatch-plans/:id/diff`   (read) → preview
- `POST /transportation/dispatch-plans`            (`transportation.planning.manage`) → DRAFT
- `POST /transportation/dispatch-plans/:id/propose` (manage)
- `POST /transportation/dispatch-plans/:id/commit`  (manage)
- `POST /transportation/dispatch-plans/:id/discard` (manage)

Aucune nouvelle permission (réutilise `transportation.planning.read|manage`).

## Web

`/dispatch-plans` : liste (statut, #items, date, qui) + détail (items avec diff/committable, actions
propose/commit/discard selon statut). Lien nav Transport → Postes de travail. Entrée depuis le Dispatch
(« Proposer un plan » à partir d'une sélection) = amélioration possible, non bloquante en v1.

## Tests

- unit : `canTransitionDispatchPlan` (toutes transitions + terminaux).
- e2e `dispatch-plans` : create DRAFT → propose → diff → commit (load créé, shipments PLANNED) ;
  **double-commit refusé** (claim) ; item avec shipment déjà assigné → `error` renseignée sans casser ;
  isolation tenant (plan d'un autre tenant invisible/inaccessible).

## Critère de réussite

Un opérateur peut proposer une consolidation, voir ce qu'elle changera, puis la committer en un geste
gouverné et tracé ; l'historique des plans est versionné. `pnpm typecheck` vert ; e2e verts ; vérifié
au navigateur. Aucune régression sur le chemin `/loads/consolidate` existant (intouché).
