import { APS_CONTRACT_VERSION, type ApsSnapshot } from './aps.types';

/**
 * A tiny, self-contained canonical snapshot used to prove the Pulsar↔APS
 * round-trip (foundation acceptance criterion): one Mon–Fri calendar, two
 * machines, one work order with two finish-to-start operations. Dates are
 * computed relative to `now` so the demo never looks stale. The expected
 * schedule places op-1 on m1 then op-2 on m2 (op-2.start ≥ op-1.end).
 */
export function buildSmokeSnapshot(now: Date = new Date()): ApsSnapshot {
  const iso = (d: Date) => d.toISOString().slice(0, 19); // drop ms/zone — engine reads naive local
  const plusDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
  const release = new Date(now);
  const due = plusDays(now, 5);
  const weekdayShift = (weekday: number) => ({ weekday, start: '08:00', end: '16:00' });
  return {
    contract_version: APS_CONTRACT_VERSION,
    exported_at: iso(now),
    source_system: 'pulsar-aps-smoke',
    calendars: [
      {
        id: 'smoke-cal',
        name: 'Smoke Standard (Mon–Fri 08:00–16:00)',
        shifts: [0, 1, 2, 3, 4].map(weekdayShift),
      },
    ],
    machines: [
      { id: 'smoke-m1', name: 'Smoke Machine 1', calendar_id: 'smoke-cal' },
      { id: 'smoke-m2', name: 'Smoke Machine 2', calendar_id: 'smoke-cal' },
    ],
    work_orders: [
      {
        id: 'smoke-wo-1',
        name: 'Smoke Widget',
        product_id: 'SMOKE-P1',
        quantity: 1,
        release_date: iso(release),
        due_date: iso(due),
        operations: [
          {
            id: 'smoke-op-1',
            work_order_id: 'smoke-wo-1',
            sequence: 1,
            name: 'Cut',
            duration_minutes: 60,
            eligible_machine_ids: ['smoke-m1'],
          },
          {
            id: 'smoke-op-2',
            work_order_id: 'smoke-wo-1',
            sequence: 2,
            name: 'Assemble',
            duration_minutes: 30,
            eligible_machine_ids: ['smoke-m2'],
            dependencies: ['smoke-op-1'],
          },
        ],
      },
    ],
    metadata: { purpose: 'aps-runtime-foundation-smoke' },
  };
}
