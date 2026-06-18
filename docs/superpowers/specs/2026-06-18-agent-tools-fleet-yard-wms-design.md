# Chantier 3 — Outils agents Fleet / Yard / WMS

Date : 2026-06-18 · Branche : `analytics-control-tower`

## Objectif

Étendre le registre d'outils agents (`core/agents/tool-registry.ts`) aux modules Fleet, Yard, WMS,
pour que « chaque module vienne avec son employé IA ». Tous les outils passent par le registre
(règle 21), tier déclaré → la file `ProposedAction` est gérée par `handleMutatingTool`
(règle 22). Aucune migration, aucun nouveau service : on réutilise les services métier existants.

## Architecture

- Ajouter les `ToolDef` au tableau `TOOL_REGISTRY` (chaque outil : `{name, description, tier,
  permission, module, inputSchema (zod), run(args, ctx)}`).
- Étendre l'interface `ToolServices` (dans `tool-registry.ts`) avec les services Fleet/Yard/WMS.
- Câbler ces services dans le provider `AGENT_TOOL_SERVICES` (`agents.module.ts`) : importer
  `FleetModule`/`YardModule`/`WmsModule` (ou les services exportés), les ajouter à `inject[]` et au
  `useFactory`. Vérifier que ces modules **exportent** bien leurs services ; sinon ajouter l'export.
- `mcp-server.factory.ts` : **ne pas toucher** (filtre déjà par permission ∩ module ∩ allowlist).
- `run` appelle le service avec `ctx.principal.user.tenantId` (isolation, règle 1) et
  `ctx.principal.user.id` (acteur = service-account de l'agent). Pour MUTATING/SENSITIVE, `run`
  est invoqué plus tard par `ProposedActionsService.approve` — on écrit quand même un `run` normal.

## Outils (uniquement ceux adossés à un service existant)

### Fleet (`module: fleet`)
| name | tier | permission | service |
|---|---|---|---|
| `list_assets` | READ | fleet.read | `VehiclesService.list` + `TrailersService.list` → `{vehicles, trailers}` |
| `get_vehicle` | READ | fleet.read | `VehiclesService.get(tenantId, id)` |
| `get_trailer` | READ | fleet.read | `TrailersService.get(tenantId, id)` |
| `list_maintenance_due` | READ | fleet.read | `FleetOverviewService.overview(tenantId)` (maintenanceDue + pmDue/pmOverdue) |
| `flag_expiring_compliance` | READ | fleet.read | `ComplianceService.expiring(tenantId, days?)` |
| `create_maintenance_order` | MUTATING | fleet.manage | `MaintenanceService.create(tenantId, userId, dto)` |
| `mark_asset_out_of_service` | MUTATING | fleet.manage | `MaintenanceService.create` (type REPAIR — rule 32 : statut asset ne change QUE via WO) ; description « Hors service (agent) » |

### Yard (`module: yard`)
| name | tier | permission | service |
|---|---|---|---|
| `list_yard_visits` | READ | yard.read | `VisitsService.list(tenantId, q)` |
| `get_yard_board` | READ | yard.read | `YardOverviewService.board(tenantId, locationId?)` |
| `flag_detention` | READ | yard.read | `YardOverviewService.overview(tenantId)` (detentionCount, lateAppointments) |
| `assign_yard_spot` | MUTATING | yard.manage | `VisitsService.assign(tenantId, userId, visitId, {spotId, note?})` |
| `move_trailer` | MUTATING | yard.manage | `VisitsService.move(tenantId, userId, visitId, {spotId, note?})` |
| `create_dock_appointment` | MUTATING | yard.manage | `AppointmentsService.create(tenantId, userId, dto)` |
| `mark_arrived` | MUTATING | yard.manage | `AppointmentsService.arrive(tenantId, userId, id)` |
| `mark_departed` | MUTATING | yard.manage | `VisitsService.checkOut(tenantId, userId, visitId)` |

### WMS (`module: wms`)
| name | tier | permission | service |
|---|---|---|---|
| `list_low_stock_items` | READ | wms.read | `WmsOverviewService.overview(tenantId)` → `belowMin` |
| `get_pick_order` | READ | wms.read | `PickingService.get(tenantId, id)` |
| `flag_inventory_variance` | READ | wms.read | `WmsOverviewService.overview(tenantId)` → `negativeBins` |
| `create_cycle_count` | MUTATING | wms.manage | `CycleCountsService.create(tenantId, userId, {binId, note?})` |

## Différés (pas de service adossé / advisory) — documentés, non implémentés
- `upload_compliance_document` : l'agent n'a pas de binaire à passer en MCP (fichiers via
  `DocumentsService` avec body) — à traiter quand l'ingestion (Chantier 4) existera.
- `suggest_asset_replacement` : purement consultatif (raisonnement LLM), aucun service.
- `create_replenishment_task` / `prioritize_pick_orders` : pas de méthode service propre
  (replenishment dérivé via `computeReplenishment` ; pas de champ priorité sur PickOrder).
- `release_shipment_when_pick_complete` : le « prêt » d'un shipment est **dérivé**
  (`deriveShipmentPickStatus`, rule 33 v2), jamais une action de release — la complétion du pick
  émet déjà l'évènement. Rien à exposer.

## Vérification
`pnpm --filter @pulsar/api typecheck` (0 nouvelle erreur ; ignorer les 5 TS2554 préexistantes).
Smoke optionnel : un agent avec `fleet.read`+module fleet voit les outils Fleet via le MCP.
Pas de test unitaire (logique = wiring ; les services sont déjà testés/utilisés).

## Critères de succès
1. ~19 nouveaux `ToolDef` enregistrés, tier/permission/module corrects, via services existants.
2. `ToolServices` étendu + services câblés dans `agents.module.ts` (modules exportent leurs services).
3. Tenant isolation via `ctx.principal.user.tenantId` partout ; MUTATING → file (non exécuté direct).
4. typecheck api propre (hors préexistants) ; `mcp-server.factory.ts` non modifié.
