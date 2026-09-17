import {
  APS_BRIDGE_VERSION,
  APS_CONTRACT_VERSION,
  APS_ENGINE_REVISION,
  type ApsBridgeRequest,
} from '../../../core/aps/aps.types';
import {
  artifactHash,
  explicitHorizon,
  parseApsUtc,
  validateEngineResult,
  validateSnapshot,
} from './aps-artifact';

const request = (): ApsBridgeRequest => ({
  bridge_version: APS_BRIDGE_VERSION,
  time_zone: 'UTC',
  horizon_start: '2026-01-05T00:00:00',
  horizon_days: 7,
  snapshot: {
    contract_version: APS_CONTRACT_VERSION,
    exported_at: '2026-01-05T00:00:00',
    source_system: 'pulsar',
    calendars: [{ id: 'c', name: 'Week' }],
    machines: [{ id: 'm', name: 'Cut', calendar_id: 'c' }],
    work_orders: [
      {
        id: 'o',
        name: 'Order',
        product_id: 'p',
        quantity: 1,
        due_date: '2026-01-09T17:00:00',
        release_date: '2026-01-05T08:00:00',
        operations: [
          {
            id: 'op',
            work_order_id: 'o',
            sequence: 1,
            name: 'Cut',
            duration_minutes: 60,
            eligible_machine_ids: ['m'],
          },
        ],
      },
    ],
  },
});
const result = () => ({
  bridge_version: APS_BRIDGE_VERSION,
  engine_revision: APS_ENGINE_REVISION,
  engine_version: 'aps-engine.v1',
  time_zone: 'UTC',
  organization_id: 'tenant',
  schedule_id: 'schedule',
  created_at: '2026-01-05T00:00:00.123456',
  strategy: 'greedy',
  solver_status: 'feasible',
  objective_value: 0,
  wall_time_ms: 2,
  horizon_start: '2026-01-05T00:00:00',
  horizon_end: '2026-01-12T00:00:00',
  metrics: { makespan_minutes: 60 },
  diagnostics: {},
  summary: {},
  analysis: {},
  feasibility: {},
  assignments: [
    {
      operation_id: 'op',
      work_order_id: 'o',
      machine_id: 'm',
      setup_start: '2026-01-05T08:00:00',
      start: '2026-01-05T08:00:00',
      end: '2026-01-05T09:00:00',
    },
  ],
});

describe('APS immutable artifact boundary', () => {
  it('hashes the same JSON identically across key order and JSONB round-trip', () => {
    expect(artifactHash({ b: 2, a: { z: null, a: ['x', 'y'] } })).toBe(
      artifactHash({ a: { a: ['x', 'y'], z: null }, b: 2 }),
    );
    const input = request();
    expect(artifactHash(input)).toBe(artifactHash(JSON.parse(JSON.stringify(input))));
    expect(artifactHash(input)).not.toBe(artifactHash({ ...input, horizon_days: 8 }));
  });
  it.each(['2026-03-08T02:30:00', '2026-11-01T01:30:00', '2026-01-05T08:00:00'])(
    'interprets %s as UTC even at DST boundaries',
    (date) => {
      expect(parseApsUtc(date).toISOString()).toBe(`${date}.000Z`);
    },
  );
  it.each(['2026-02-30T08:00:00', 'invalid', '2026-01-05T08:00:00-05:00', '2026-01-05T24:00:00'])(
    'rejects ambiguous/invalid engine timestamp %s',
    (date) => {
      expect(() => parseApsUtc(date)).toThrow();
    },
  );
  it('captures the default horizon and accepts existing date-only UI inputs', () => {
    expect(explicitHorizon(undefined, new Date('2026-01-05T13:14:15Z'))).toBe(
      '2026-01-05T00:00:00',
    );
    expect(explicitHorizon('2026-01-06', new Date())).toBe('2026-01-06T00:00:00');
    expect(() => explicitHorizon('2026-02-30', new Date())).toThrow();
  });
  it('accepts a complete result and current references', () => {
    expect(() => validateSnapshot(request().snapshot)).not.toThrow();
    expect(validateEngineResult(result(), request(), 'tenant')).toEqual(result());
  });
  it.each([
    'tenant',
    'version',
    'horizon',
    'machine',
    'order',
    'missing',
    'duplicate',
    'date',
    'number',
    'json',
  ])('rejects invalid result: %s', (kind) => {
    const r = result();
    if (kind === 'tenant') r.organization_id = 'other';
    if (kind === 'version') (r as any).bridge_version = 'old';
    if (kind === 'horizon') r.horizon_end = '2026-01-13T00:00:00';
    if (kind === 'machine') r.assignments[0].machine_id = 'other';
    if (kind === 'order') r.assignments[0].work_order_id = 'other';
    if (kind === 'missing') r.assignments = [];
    if (kind === 'duplicate') r.assignments.push(r.assignments[0]);
    if (kind === 'date') r.assignments[0].end = '2026-01-05T07:00:00';
    if (kind === 'number') r.objective_value = Number.NaN;
    if (kind === 'json') (r as any).metrics = 'invalid';
    expect(() => validateEngineResult(r, request(), 'tenant')).toThrow('Invalid APS bridge result');
  });
  it.each(['empty', 'unknown', 'calendar', 'predecessor', 'started', 'duplicate'])(
    'rejects incomplete snapshot: %s',
    (kind) => {
      const s = request().snapshot,
        o = s.work_orders![0],
        op = o.operations[0];
      if (kind === 'empty') o.operations = [];
      if (kind === 'unknown') op.eligible_machine_ids = ['other'];
      if (kind === 'calendar') s.calendars = [];
      if (kind === 'predecessor') op.dependencies = ['other'];
      if (kind === 'started') op.status = 'in_progress';
      if (kind === 'duplicate') o.operations.push(op);
      expect(() => validateSnapshot(s)).toThrow();
    },
  );
});
