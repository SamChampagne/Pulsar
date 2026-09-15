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
    {
      id: 'op1',
      sequence: 1,
      name: 'Cut',
      durationMinutes: 60,
      setupMinutes: 0,
      eligibleWorkCenterIds: ['wc1'],
      dependsOn: [],
    },
    {
      id: 'op2',
      sequence: 2,
      name: 'Asm',
      durationMinutes: 30,
      setupMinutes: 5,
      eligibleWorkCenterIds: ['wc2'],
      dependsOn: [],
    },
  ],
  ...over,
});

describe('buildManufacturingSnapshot', () => {
  it('captures material-ready release dates without mutating the original order', () => {
    const order = baseOrder();
    const { snapshot } = buildManufacturingSnapshot({
      exportedAt,
      calendars: [],
      workCenters: [],
      orders: [order],
      materials: {
        inventory: [{ materialRef: 'RAW', onHand: 0 }],
        byOrder: { o1: [{ materialRef: 'RAW', fixedQuantity: 2 }] },
        supplies: [
          { id: 'purchase:p', materialRef: 'RAW', quantity: 2, availableAt: '2026-07-01T00:00:00' },
        ],
        readyDates: { o1: '2026-07-01T00:00:00' },
      },
    });
    expect(snapshot.work_orders![0].release_date).toBe('2026-07-01T00:00:00');
    expect(order.releaseDate.toISOString()).toBe('2026-06-29T08:00:00.000Z');
    expect(snapshot.supplies![0]).toMatchObject({
      id: 'purchase:p',
      material_id: 'RAW',
      quantity: 2,
    });
  });
  it('restricts sited orders to their site even when candidates are implicit', () => {
    const order = baseOrder({ locationId: 'A' });
    order.operations.forEach((op) => {
      op.eligibleWorkCenterIds = [];
    });
    const input = {
      exportedAt,
      orders: [order],
      calendars: [
        { id: 'ca', name: 'A', locationId: 'A', shifts: [] },
        { id: 'cb', name: 'B', locationId: 'B', shifts: [] },
      ],
      workCenters: [
        { id: 'a', name: 'A', calendarId: 'ca', capabilities: [], efficiency: 1 },
        { id: 'b', name: 'B', calendarId: 'cb', capabilities: [], efficiency: 1 },
      ],
    };
    expect(
      buildManufacturingSnapshot(input).snapshot.work_orders![0].operations[0].eligible_machine_ids,
    ).toEqual(['a']);
    order.operations[0].eligibleWorkCenterIds = ['b'];
    expect(() => buildManufacturingSnapshot(input)).toThrow(/aucun poste compatible/);
    order.locationId = null;
    order.operations[0].eligibleWorkCenterIds = [];
    expect(() => buildManufacturingSnapshot(input)).toThrow(/aucun poste compatible/);
  });
  it('maps calendars, machines and orders to the canonical contract', () => {
    const { snapshot } = buildManufacturingSnapshot({
      exportedAt,
      calendars: [
        { id: 'cal1', name: 'Std', shifts: [{ weekday: 0, startTime: '08:00', endTime: '16:00' }] },
      ],
      workCenters: [
        { id: 'wc1', name: 'Cut', calendarId: 'cal1', capabilities: ['cnc'], efficiency: 1 },
      ],
      orders: [baseOrder()],
    });
    expect(snapshot.contract_version).toBe(APS_CONTRACT_VERSION);
    expect(snapshot.source_system).toBe('pulsar-manufacturing');
    expect(snapshot.machines![0]).toMatchObject({ id: 'wc1', calendar_id: 'cal1' });
    expect(snapshot.calendars![0]!.shifts![0]).toEqual({
      weekday: 0,
      start: '08:00',
      end: '16:00',
    });
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
    const { snapshot } = buildManufacturingSnapshot({
      exportedAt,
      calendars: [],
      workCenters: [],
      orders: [order],
    });
    expect(snapshot.work_orders![0]!.operations[1]!.dependencies).toEqual(['opX']);
  });

  it('preserves operations without an eligible work center for fail-closed validation', () => {
    const order = baseOrder();
    order.operations[0]!.eligibleWorkCenterIds = [];
    const res = buildManufacturingSnapshot({
      exportedAt,
      calendars: [],
      workCenters: [],
      orders: [order],
    });
    expect(res.snapshot.work_orders![0]!.operations).toHaveLength(2);
    expect(res.snapshot.work_orders![0]!.operations[0]!.eligible_machine_ids).toEqual([]);
  });

  it('does not remove an order whose operations are all unschedulable', () => {
    const order = baseOrder();
    order.operations.forEach((op) => (op.eligibleWorkCenterIds = []));
    const res = buildManufacturingSnapshot({
      exportedAt,
      calendars: [],
      workCenters: [],
      orders: [order],
    });
    expect(res.orderCount).toBe(1);
    expect(res.snapshot.work_orders).toHaveLength(1);
    expect(res.operationCount).toBe(2);
  });

  it('SP5: attaches WMS inventory + op-1 material requirements when materials provided', () => {
    const { snapshot } = buildManufacturingSnapshot({
      exportedAt,
      calendars: [],
      workCenters: [],
      orders: [baseOrder()],
      materials: {
        inventory: [{ materialRef: 'STEEL', onHand: 500 }],
        byOrder: { o1: [{ materialRef: 'STEEL', fixedQuantity: 50 }] },
      },
    });
    expect(snapshot.inventory_items).toEqual([{ material_id: 'STEEL', quantity_on_hand: 500 }]);
    const ops = snapshot.work_orders![0]!.operations;
    expect(ops[0]!.material_requirements).toEqual([{ material_id: 'STEEL', fixed_quantity: 50 }]);
    expect(ops[1]!.material_requirements).toBeUndefined(); // only op 1 carries them
  });

  it('SP5: warns when a required material has no matching WMS stock', () => {
    const res = buildManufacturingSnapshot({
      exportedAt,
      calendars: [],
      workCenters: [],
      orders: [baseOrder()],
      materials: {
        inventory: [], // STEEL not stocked
        byOrder: { o1: [{ materialRef: 'STEEL', fixedQuantity: 50 }] },
      },
    });
    expect(res.warnings.some((w) => w.includes('no matching WMS stock'))).toBe(true);
  });

  it('omits inventory_items entirely when no materials provided (unchanged behaviour)', () => {
    const { snapshot } = buildManufacturingSnapshot({
      exportedAt,
      calendars: [],
      workCenters: [],
      orders: [baseOrder()],
    });
    expect(snapshot.inventory_items).toBeUndefined();
    expect(snapshot.work_orders![0]!.operations[0]!.material_requirements).toBeUndefined();
  });
});
