import { createHash } from 'node:crypto';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { z } from 'zod';
import {
  APS_BRIDGE_VERSION,
  APS_ENGINE_REVISION,
  APS_BRIDGE_V2,
  APS_ENGINE_V2,
  type ApsBridgeRequest,
  type ApsBridgeResponse,
  type ApsSnapshot,
} from '../../../core/aps/aps.types';

/** Sorted object keys, preserved array order. Hashes the exact replay request. */
function canonicalJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function artifactHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

/** Never let new Date(naive) pick the host's local timezone. */
export function parseApsUtc(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(value)) {
    throw new Error('Expected an APS UTC wall-clock timestamp');
  }
  const date = new Date(`${value}Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== value.slice(0, 19)) {
    throw new Error('Invalid APS timestamp');
  }
  return date;
}

export function explicitHorizon(value: string | undefined, now: Date): string {
  if (!value) return `${now.toISOString().slice(0, 10)}T00:00:00`;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value;
  try {
    // Existing UI submits dates. Accept an explicit UTC suffix too, never a host-local interpretation.
    return parseApsUtc(normalized.replace(/Z$/, '')).toISOString().slice(0, 19);
  } catch {
    throw new BadRequestException('horizonStart must be a valid UTC date or UTC datetime');
  }
}

export function validateSnapshot(snapshot: ApsSnapshot): void {
  const fail = (message: string): never => {
    throw new BadRequestException(message);
  };
  const unique = (ids: string[], label: string) => {
    if (new Set(ids).size !== ids.length) fail(`Duplicate ${label} in manufacturing snapshot`);
  };
  const calendars = new Set((snapshot.calendars ?? []).map((c) => c.id));
  const machines = new Map((snapshot.machines ?? []).map((m) => [m.id, m]));
  unique(
    (snapshot.calendars ?? []).map((c) => c.id),
    'calendar',
  );
  unique(
    (snapshot.machines ?? []).map((m) => m.id),
    'work center',
  );
  for (const m of machines.values()) {
    if (!calendars.has(m.calendar_id)) fail(`Work center ${m.name}: calendar missing or inactive`);
  }
  const orders = snapshot.work_orders ?? [];
  unique(
    orders.map((o) => o.id),
    'order',
  );
  const operations = orders.flatMap((o) => o.operations);
  unique(
    operations.map((o) => o.id),
    'operation',
  );
  if (!orders.length) fail('No manufacturing orders to schedule');
  for (const order of orders) {
    if (!order.operations.length)
      fail(`Order ${order.name}: no operations; demand cannot be dropped`);
    const ids = new Set(order.operations.map((o) => o.id));
    for (const op of order.operations) {
      if (op.work_order_id !== order.id) fail(`Operation ${op.name}: wrong order`);
      if (
        !op.eligible_machine_ids.length ||
        op.eligible_machine_ids.some((id) => !machines.has(id))
      ) {
        fail(`Operation ${op.name}: eligible work center missing or inactive`);
      }
      if (op.dependencies?.some((id) => id === op.id || !ids.has(id))) {
        fail(`Operation ${op.name}: invalid predecessor in this order`);
      }
      if (op.status === 'in_progress' || op.status === 'completed') {
        fail(
          `Operation ${op.name}: actual execution data is required before replanning started work`,
        );
      }
    }
  }
}

const jsonObject = z.record(z.string(), z.unknown());
const integer = z.number().int().min(0).max(2_147_483_647);
const responseSchema = z
  .object({
    bridge_version: z.enum([APS_BRIDGE_VERSION, APS_BRIDGE_V2]),
    engine_revision: z.enum([APS_ENGINE_REVISION, APS_ENGINE_V2]),
    engine_version: z.string().min(1),
    time_zone: z.string().min(1),
    organization_id: z.string().min(1),
    schedule_id: z.string().min(1),
    created_at: z.string(),
    strategy: z.string().min(1),
    solver_status: z.string().min(1),
    objective_value: integer,
    wall_time_ms: integer,
    horizon_start: z.string(),
    horizon_end: z.string(),
    assignments: z.array(
      z
        .object({
          operation_id: z.string(),
          work_order_id: z.string(),
          machine_id: z.string(),
          setup_start: z.string(),
          start: z.string(),
          end: z.string(),
        })
        .passthrough(),
    ),
    metrics: jsonObject,
    diagnostics: jsonObject,
    summary: jsonObject.nullable(),
    analysis: jsonObject.nullable(),
    feasibility: jsonObject.nullable(),
  })
  .passthrough();

/** Contract validation, not a second solver. Scheduling rules stay in Python. */
export function validateEngineResult(
  raw: unknown,
  request: ApsBridgeRequest,
  tenantId: string,
): ApsBridgeResponse {
  try {
    const result = responseSchema.parse(raw);
    if (result.organization_id !== tenantId) throw new Error('tenant mismatch');
    if (
      result.bridge_version !== request.bridge_version ||
      result.time_zone !== request.time_zone ||
      result.engine_revision !==
        (request.bridge_version === APS_BRIDGE_V2 ? APS_ENGINE_V2 : APS_ENGINE_REVISION)
    )
      throw new Error('provenance mismatch');
    parseApsUtc(result.created_at);
    const start = parseApsUtc(result.horizon_start).getTime();
    const end = parseApsUtc(result.horizon_end).getTime();
    if (
      start !== parseApsUtc(request.horizon_start).getTime() ||
      end !==
        (request.bridge_version === APS_BRIDGE_V2
          ? parseApsUtc(request.horizon_end).getTime()
          : start + (request.horizon_days ?? 30) * 86_400_000)
    )
      throw new Error('horizon mismatch');
    const ops = new Map(
      (request.snapshot.work_orders ?? []).flatMap((o) => o.operations).map((o) => [o.id, o]),
    );
    const seen = new Set<string>();
    for (const a of result.assignments) {
      const op = ops.get(a.operation_id);
      if (
        !op ||
        op.work_order_id !== a.work_order_id ||
        !op.eligible_machine_ids.includes(a.machine_id) ||
        seen.has(a.operation_id)
      )
        throw new Error('assignment reference mismatch');
      seen.add(a.operation_id);
      const setup = parseApsUtc(a.setup_start).getTime();
      const runStart = parseApsUtc(a.start).getTime();
      const runEnd = parseApsUtc(a.end).getTime();
      if (setup > runStart || runStart >= runEnd) throw new Error('assignment dates invalid');
    }
    if (result.solver_status === 'feasible' && seen.size !== ops.size)
      throw new Error('missing operations');
    return result as ApsBridgeResponse;
  } catch {
    throw new ServiceUnavailableException('Invalid APS bridge result; no planning changes saved');
  }
}
