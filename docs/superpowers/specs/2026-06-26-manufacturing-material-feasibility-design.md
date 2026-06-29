# Manufacturing Material Feasibility ↔ WMS — Design (sub-project 5)

**Date:** 2026-06-26 · **Branch:** `manufacturing-aps` · **Depends on:** SP2 (BOM), SP3 (scheduling), WMS module

## Context

The APS engine already models material feasibility: a `MaterialLedger` defers operations until
their input materials are available (on-hand + incoming supply). SP5 feeds Pulsar's **WMS
inventory** into that ledger so a schedule respects what's actually in stock — the headline
cross-module synergy of the arc.

## Goal (v1, opt-in, non-breaking)

`POST /manufacturing/scheduling/run` gains an optional `respectMaterials: boolean` (default
**false** → current behaviour, no material constraints). When true and the WMS module is enabled:

- For each scheduled order with a `bomId`, derive material requirements from its BOM lines
  (`fixed_quantity = quantityPerUnit × order.quantity`, keyed by `materialRef`) and attach them to
  the order's **first** operation (APS `material_requirements`).
- Aggregate WMS on-hand per material: `materialRef` is matched to `WmsItem.sku`; on-hand =
  Σ `InventoryLevel.qtyOnHand` across bins for that item. Emit as snapshot `inventory_items`
  (`{ material_id: materialRef, quantity_on_hand }`).
- Materials with no matching WMS item are omitted from `inventory_items` (on-hand 0 at the engine);
  to avoid silently starving demand, the run records a **warning** per unmatched material.

The engine's MaterialLedger then schedules feasibly: ops whose materials aren't yet on-hand are
deferred. No supply-lot / incoming-PO modelling in v1 (on-hand snapshot only).

## Non-goals
- No write-back of material consumption to WMS (scheduling is a plan, not execution).
- No supply lots / lead times (future: map open POs → `supplies`).
- No per-operation material mapping (BOM is order-level in v1 → attached to op 1).

## Changes
- `aps.types`: extend `ApsSnapshot` with `inventory_items?` and `ApsOperation` with
  `material_requirements?` (mirror engine `CanonicalInventoryItem` / `CanonicalMaterialRequirement`).
- `buildManufacturingSnapshot`: accept optional `materials` ({ inventory: {materialRef,onHand}[],
  byOrder: Record<orderId, {materialRef, fixedQuantity}[]> }); attach inventory_items + op-1
  material_requirements; warn on unmatched.
- `SchedulingService.run`: when `respectMaterials`, gate on WMS enabled (best-effort: if WMS off,
  ignore the flag with a warning), load WmsItem + InventoryLevel aggregates and per-order BOM lines,
  pass to the builder.
- Controller: `respectMaterials?: boolean` on the run DTO.

## Testing
- Unit: builder attaches inventory_items + op-1 material_requirements; warns on unmatched material.
- e2e (gated on APS install): seed a WMS item with on-hand + a BOM on the demo MO; run with
  `respectMaterials:true`; assert the run succeeds and (with ample stock) assignments are unchanged;
  a low-stock variant defers/omits — assert a warning or deferral. (Kept light; engine behaviour is
  its own tested concern.)
