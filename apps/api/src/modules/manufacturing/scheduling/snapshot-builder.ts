import {
  APS_FIRMNESS_WIRE,
  APS_PRIORITY_WIRE,
  ManufacturingFirmness,
  ManufacturingPriority,
} from '@pulsar/shared';
import { APS_CONTRACT_VERSION, type ApsSnapshot } from '../../../core/aps/aps.types';

/** Plain row shapes the builder consumes (tenant pre-filtered by the caller). */
export interface SnapshotCalendarRow {
  id: string;
  name: string;
  shifts: { weekday: number; startTime: string; endTime: string }[];
}
export interface SnapshotWorkCenterRow {
  id: string;
  name: string;
  calendarId: string;
  capabilities: string[];
  efficiency: number;
}
export interface SnapshotOperationRow {
  id: string;
  sequence: number;
  name: string;
  durationMinutes: number;
  setupMinutes: number;
  eligibleWorkCenterIds: string[];
  dependsOn: string[];
}
export interface SnapshotOrderRow {
  id: string;
  name: string;
  productRef: string;
  quantity: number;
  dueDate: Date;
  releaseDate: Date;
  priority: ManufacturingPriority;
  firmness: ManufacturingFirmness;
  operations: SnapshotOperationRow[];
}

export interface SnapshotBuildResult {
  snapshot: ApsSnapshot;
  warnings: string[];
  orderCount: number;
  operationCount: number;
}

/** APS reads naive local datetimes — emit "YYYY-MM-DDTHH:MM:SS" without zone. */
function naiveIso(d: Date): string {
  return d.toISOString().slice(0, 19);
}

/**
 * Pure mapping of Pulsar manufacturing rows → the APS canonical snapshot
 * (contract validated in SP1). Deterministic: same inputs + `exportedAt` →
 * same snapshot. Orders with no operations, and operations with no eligible
 * work center, are dropped with a recorded warning so demand is never silently
 * lost. When an operation has no explicit `dependsOn`, a finish-to-start chain
 * is derived from `sequence` (op N depends on the previous op id).
 */
export interface SnapshotMaterials {
  /** Aggregated WMS on-hand per material ref (materialRef === WmsItem.sku). */
  inventory: { materialRef: string; onHand: number }[];
  /** Material requirements per order id (from the order's BOM × quantity). */
  byOrder: Record<string, { materialRef: string; fixedQuantity: number }[]>;
}

export function buildManufacturingSnapshot(input: {
  calendars: SnapshotCalendarRow[];
  workCenters: SnapshotWorkCenterRow[];
  orders: SnapshotOrderRow[];
  exportedAt: Date;
  /** When provided (SP5 opt-in), wires WMS inventory into the engine's material ledger. */
  materials?: SnapshotMaterials;
}): SnapshotBuildResult {
  const warnings: string[] = [];
  const onHand = new Map((input.materials?.inventory ?? []).map((i) => [i.materialRef, i.onHand]));

  const calendars = input.calendars.map((c) => ({
    id: c.id,
    name: c.name,
    shifts: c.shifts
      .slice()
      .sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime))
      .map((s) => ({ weekday: s.weekday, start: s.startTime, end: s.endTime })),
  }));

  const machines = input.workCenters.map((w) => ({
    id: w.id,
    name: w.name,
    calendar_id: w.calendarId,
    capabilities: w.capabilities,
    efficiency: w.efficiency,
  }));

  const workOrders: NonNullable<ApsSnapshot['work_orders']> = [];
  let operationCount = 0;

  for (const order of input.orders) {
    const sorted = order.operations.slice().sort((a, b) => a.sequence - b.sequence);
    const usable = sorted.filter((op) => {
      if (op.eligibleWorkCenterIds.length === 0) {
        warnings.push(
          `Operation "${op.name}" (order ${order.name}) has no eligible work center — skipped.`,
        );
        return false;
      }
      return true;
    });
    if (usable.length === 0) {
      warnings.push(`Order "${order.name}" has no schedulable operations — skipped.`);
      continue;
    }
    // Material requirements (SP5): the order's BOM-derived needs attach to op 1.
    const reqs = input.materials?.byOrder[order.id] ?? [];
    for (const r of reqs) {
      if (!onHand.has(r.materialRef)) {
        warnings.push(
          `Material "${r.materialRef}" (order ${order.name}) has no matching WMS stock — treated as 0 on-hand.`,
        );
      }
    }
    const operations = usable.map((op, idx) => {
      const dependencies =
        op.dependsOn.length > 0 ? op.dependsOn : idx > 0 ? [usable[idx - 1].id] : [];
      return {
        id: op.id,
        work_order_id: order.id,
        sequence: op.sequence,
        name: op.name,
        duration_minutes: op.durationMinutes,
        eligible_machine_ids: op.eligibleWorkCenterIds,
        setup_minutes: op.setupMinutes,
        dependencies,
        ...(idx === 0 && reqs.length > 0
          ? { material_requirements: reqs.map((r) => ({ material_id: r.materialRef, fixed_quantity: r.fixedQuantity })) }
          : {}),
      };
    });
    operationCount += operations.length;
    workOrders.push({
      id: order.id,
      name: order.name,
      product_id: order.productRef,
      quantity: order.quantity,
      due_date: naiveIso(order.dueDate),
      release_date: naiveIso(order.releaseDate),
      priority: APS_PRIORITY_WIRE[order.priority],
      firmness: APS_FIRMNESS_WIRE[order.firmness],
      operations,
    });
  }

  const inventory_items = (input.materials?.inventory ?? []).map((i) => ({
    material_id: i.materialRef,
    quantity_on_hand: i.onHand,
  }));

  const snapshot: ApsSnapshot = {
    contract_version: APS_CONTRACT_VERSION,
    exported_at: naiveIso(input.exportedAt),
    source_system: 'pulsar-manufacturing',
    calendars,
    machines,
    work_orders: workOrders,
    ...(inventory_items.length > 0 ? { inventory_items } : {}),
    metadata: { tenant_orders: input.orders.length },
  };

  return { snapshot, warnings, orderCount: workOrders.length, operationCount };
}
