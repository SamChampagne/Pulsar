import { ManufacturingFirmness, ManufacturingPriority } from '@pulsar/shared';
import { APS_CONTRACT_VERSION } from '../../../core/aps/aps.types';
import { buildManufacturingSnapshot, type SnapshotOrderRow } from './snapshot-builder';

const exportedAt = new Date('2026-06-26T12:00:00Z');

const baseOrder = (over: Partial<SnapshotOrderRow> = {}): SnapshotOrderRow => ({
  id: 'o1',
  name: 'Order 1',
  productRef: 'P1',
  quantity: 5,
  dueDate: new Date('2026-07-03T16:00:00Z'),
  releaseDate: new Date('2026-06-29T08:00:00Z'),
  priority: ManufacturingPriority.HIGH,
  firmness: ManufacturingFirmness.FIRM,
  operations: [
    { id: 'op1', sequence: 1, name: 'Cut', durationMinutes: 60, setupMinutes: 0, eligibleWorkCenterIds: ['wc1'], dependsOn: [] },
    { id: 'op2', sequence: 2, name: 'Asm', durationMinutes: 30, setupMinutes: 5, eligibleWorkCenterIds: ['wc2'], dependsOn: [] },
  ],
  ...over,
});

describe('buildManufacturingSnapshot', () => {
  it('maps calendars, machines and orders to the canonical contract', () => {
    const { snapshot } = buildManufacturingSnapshot({
      exportedAt,
      calendars: [{ id: 'cal1', name: 'Std', shifts: [{ weekday: 0, startTime: '08:00', endTime: '16:00' }] }],
      workCenters: [{ id: 'wc1', name: 'Cut', calendarId: 'cal1', capabilities: ['cnc'], efficiency: 1 }],
      orders: [baseOrder()],
    });
    expect(snapshot.contract_version).toBe(APS_CONTRACT_VERSION);
    expect(snapshot.source_system).toBe('pulsar-manufacturing');
    expect(snapshot.machines![0]).toMatchObject({ id: 'wc1', calendar_id: 'cal1' });
    expect(snapshot.calendars![0]!.shifts![0]).toEqual({ weekday: 0, start: '08:00', end: '16:00' });
    const wo = snapshot.work_orders![0]!;
    expect(wo).toMatchObject({ id: 'o1', product_id: 'P1', priority: 'high', firmness: 'firm' });
    // naive datetime (no zone/ms)
    expect(wo.due_date).toBe('2026-07-03T16:00:00');
  });

  it('derives a finish-to-start chain from sequence when dependsOn is empty', () => {
    const { snapshot } = buildManufacturingSnapshot({
      exportedAt,
      calendars: [],
      workCenters: [],
      orders: [baseOrder()],
    });
    const ops = snapshot.work_orders![0]!.operations;
    expect(ops[0]!.dependencies).toEqual([]);
    expect(ops[1]!.dependencies).toEqual(['op1']); // op2 depends on op1
  });

  it('honours explicit dependsOn over the derived chain', () => {
    const order = baseOrder();
    order.operations[1]!.dependsOn = ['opX'];
    const { snapshot } = buildManufacturingSnapshot({ exportedAt, calendars: [], workCenters: [], orders: [order] });
    expect(snapshot.work_orders![0]!.operations[1]!.dependencies).toEqual(['opX']);
  });

  it('skips operations with no eligible work center and warns', () => {
    const order = baseOrder();
    order.operations[0]!.eligibleWorkCenterIds = [];
    const res = buildManufacturingSnapshot({ exportedAt, calendars: [], workCenters: [], orders: [order] });
    expect(res.snapshot.work_orders![0]!.operations).toHaveLength(1); // only op2 remains
    expect(res.warnings.some((w) => w.includes('no eligible work center'))).toBe(true);
  });

  it('skips an order whose operations are all unschedulable and warns', () => {
    const order = baseOrder();
    order.operations.forEach((op) => (op.eligibleWorkCenterIds = []));
    const res = buildManufacturingSnapshot({ exportedAt, calendars: [], workCenters: [], orders: [order] });
    expect(res.orderCount).toBe(0);
    expect(res.snapshot.work_orders).toHaveLength(0);
    expect(res.warnings.some((w) => w.includes('no schedulable operations'))).toBe(true);
  });
});
