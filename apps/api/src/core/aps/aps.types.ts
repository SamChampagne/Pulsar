/**
 * TypeScript mirror of the vendored APS engine's canonical snapshot + scheduling
 * contract. These shapes were validated empirically against the running engine
 * (`/openapi.json` + a live `/integration/scheduling/run-from-snapshot` round-trip)
 * — see docs/superpowers/specs/2026-06-26-aps-runtime-foundation-design.md.
 *
 * Only the fields Pulsar uses are typed; the engine accepts many optional fields
 * (setup matrices, routings, resources, materials, firmness, lot sizing, …) that
 * later sub-projects will populate. Keep this in sync with the engine's
 * `application/integration/canonical_snapshot.py` schema.
 */

/** The only snapshot contract the engine accepts (canonical_mapper.CONTRACT_VERSION). */
export const APS_CONTRACT_VERSION = 'aps.canonical.v1';
export const APS_BRIDGE_VERSION = 'pulsar.aps.v1';
export const APS_ENGINE_REVISION = 'planiadvance-d26a8cd.pulsar-a1';
export const APS_BRIDGE_V2 = 'pulsar.aps.v2';
export const APS_ENGINE_V2 = 'planiadvance-d26a8cd.pulsar-a2';

export interface ApsShift {
  /** 0 = Monday … 6 = Sunday. */
  weekday: number;
  /** "HH:MM" local plant time. */
  start: string;
  /** "HH:MM" local plant time. */
  end: string;
}

export interface ApsCalendar {
  id: string;
  name: string;
  shifts?: ApsShift[];
  external_ref?: string | null;
  site_id?: string | null;
}

export interface ApsMachine {
  id: string;
  name: string;
  calendar_id: string;
  capabilities?: string[];
  /** time scale; 1.0 = nominal, 1.5 = 50% faster. */
  efficiency?: number;
  external_ref?: string | null;
  site_id?: string | null;
}

export interface ApsMaterialRequirement {
  material_id: string;
  /** consumed per produced unit (× work order quantity). */
  quantity_per_unit?: number;
  /** flat quantity regardless of order quantity. */
  fixed_quantity?: number;
}

export interface ApsOperation {
  status?: string;
  id: string;
  work_order_id: string;
  sequence: number;
  name: string;
  duration_minutes: number;
  eligible_machine_ids: string[];
  setup_minutes?: number;
  /** simple finish-to-start predecessor operation ids. */
  dependencies?: string[];
  setup_family?: string | null;
  material_requirements?: ApsMaterialRequirement[];
  external_ref?: string | null;
}

export interface ApsInventoryItem {
  material_id: string;
  quantity_on_hand: number;
  /** ISO-8601; engine treats material as available from this instant (default: always). */
  as_of?: string | null;
}

export interface ApsWorkOrder {
  id: string;
  name: string;
  product_id: string;
  quantity: number;
  /** ISO-8601 datetime. */
  due_date: string;
  /** ISO-8601 datetime. */
  release_date: string;
  operations: ApsOperation[];
  /** APS wire value: low | normal | high | urgent. */
  priority?: string;
  status?: string;
  /** APS wire value (Cas 2): firm | forecast | tentative. */
  firmness?: string;
  external_ref?: string | null;
  site_id?: string | null;
}

export interface ApsSnapshot {
  contract_version: string;
  /** ISO-8601 datetime the snapshot was produced. */
  exported_at: string;
  source_system: string;
  calendars?: ApsCalendar[];
  machines?: ApsMachine[];
  work_orders?: ApsWorkOrder[];
  inventory_items?: ApsInventoryItem[];
  supplies?: {
    id: string;
    material_id: string;
    quantity: number;
    available_at: string;
    source_type: string;
  }[];
  metadata?: Record<string, unknown>;
}

export interface ApsObjective {
  makespan?: number;
  total_tardiness?: number;
  weighted_tardiness?: number;
  setup_cost?: number;
  idle_penalty?: number;
}

export interface RunFromSnapshotRequest {
  snapshot: ApsSnapshot;
  /** ISO-8601; when omitted the engine derives one. */
  horizon_start?: string | null;
  horizon_days?: number;
  heuristic?: string;
  /** greedy | backward | hybrid | cpsat | infinite | sa | tabu | ga | lns | multi | auto */
  strategy?: string;
  objective?: ApsObjective | null;
}

export interface ApsScheduledOperation {
  operation_id: string;
  work_order_id: string;
  machine_id: string;
  /** ISO-8601 datetimes. */
  setup_start: string;
  start: string;
  end: string;
}

export interface RunScheduleResponse {
  schedule_id: string;
  created_at: string;
  strategy: string;
  solver_status: string;
  objective_value: number;
  wall_time_ms: number;
  assignments: ApsScheduledOperation[];
  horizon_start?: string | null;
  horizon_end?: string | null;
  metrics?: Record<string, unknown>;
  diagnostics?: Record<string, unknown>;
  summary?: Record<string, unknown> | null;
  analysis?: Record<string, unknown> | null;
  feasibility?: Record<string, unknown> | null;
}

/** V1 is explicitly UTC. Site-specific wall-clock conversion is a later contract. */
export interface ApsBridgeV1Request extends RunFromSnapshotRequest {
  bridge_version: typeof APS_BRIDGE_VERSION;
  time_zone: 'UTC';
  horizon_start: string;
}

/** Concrete UTC windows are captured, so replay does not depend on a future tz database. */
export interface ApsBridgeV2Request extends RunFromSnapshotRequest {
  bridge_version: typeof APS_BRIDGE_V2;
  time_zone: string;
  horizon_start: string;
  horizon_end: string;
  calendar_windows: Record<string, { start: string; end: string }[]>;
}
export type ApsBridgeRequest = ApsBridgeV1Request | ApsBridgeV2Request;

export interface ApsBridgeResponse extends RunScheduleResponse {
  bridge_version: typeof APS_BRIDGE_VERSION | typeof APS_BRIDGE_V2;
  engine_revision: typeof APS_ENGINE_REVISION | typeof APS_ENGINE_V2;
  engine_version: string;
  time_zone: string;
  organization_id: string;
  horizon_start: string;
  horizon_end: string;
}

export interface ApsStrategyCapability {
  name: string;
  maturity?: string;
  planning_mode?: string;
  [k: string]: unknown;
}

export interface StrategyCapabilitiesResponse {
  version: string;
  default_strategy: string;
  strategies: ApsStrategyCapability[];
}

export interface ApsHealth {
  status: string;
  service?: string;
}

export interface ApsReadiness {
  status: string;
  db_ready: boolean;
}
