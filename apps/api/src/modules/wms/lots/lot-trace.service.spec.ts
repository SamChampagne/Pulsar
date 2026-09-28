import { LotTraceService } from './lot-trace.service';
import { LotTraceQueryDto, LotTraceDossiersDto } from './lot-trace.dto';
import type { AuthUser } from '@pulsar/shared';
import { Prisma } from '@pulsar/database';

function fixture() {
  const modules = {
    getEnabledKeys: jest.fn(async () => new Set(['wms', 'manufacturing', 'transportation'])),
  };
  const tx: any = {
    wmsLot: {
      findFirst: jest.fn(async ({ where }: any) => ({
        id: where.id,
        itemId: 'item',
        code: where.id,
        disposition: 'UNRESTRICTED',
        item: { sku: 'sku', name: 'Article', unit: 'EA' },
      })),
    },
    stockMovement: { groupBy: jest.fn(async () => []) },
    pickLine: {
      findMany: jest.fn(async () => [
        {
          id: 'line',
          qty: new Prisma.Decimal(1),
          pickOrder: {
            id: 'pick',
            number: 'PK-1',
            status: 'OPEN',
            createdAt: new Date(),
            shipmentId: 'shipment',
          },
        },
      ]),
      count: jest.fn(async () => 1),
    },
    shipment: { findMany: jest.fn(async () => [{ id: 'shipment', shipmentNumber: 'SH-1' }]) },
  };
  const db: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
  const service = new LotTraceService(db, modules as any);
  const user = {
    tenantId: 'tenant',
    permissions: ['wms.read', 'manufacturing.read', 'transportation.planning.read'],
  } as AuthUser;
  const movement = (id: string, lot: string, type: string, time = '2026-09-25T12:00:00Z') => ({
    id,
    lotId: lot,
    itemId: 'item',
    lotCode: lot,
    type,
    quantity: '1',
    unit: 'EA',
    binCode: 'B',
    fromBinId: type === 'CONSUMPTION' ? 'bin' : null,
    toBinId: type === 'PRODUCTION' ? 'bin' : null,
    createdAt: time,
  });
  return { service, user, tx, db, modules, movement };
}
describe('bounded lot trace reads', () => {
  it('caps candidate declarations and lots explicitly, with no orphan nodes', async () => {
    const f = fixture();
    f.tx.stockMovement.groupBy.mockImplementation(async ({ where }: any) =>
      where.lotId === 'root' ? Array.from({ length: 81 }, (_, i) => ({ refId: `d${i}` })) : [],
    );
    const read = jest
      .spyOn(f.service as any, 'declaration')
      .mockImplementation(async (_tx: any, _tenant: any, id: any) => ({
        order: { id: 'order', number: 'OF' },
        reversed: false,
        movements: [
          f.movement(`i${id}`, 'root', 'CONSUMPTION'),
          f.movement(`o${id}`, id, 'PRODUCTION'),
        ],
      }));
    const r = await f.service.trace(f.user, 'item', 'root', new LotTraceQueryDto());
    expect(r.bounded).toBe(true);
    expect(r.nodes).toHaveLength(50);
    expect(r.edges).toHaveLength(49);
    expect(read).toHaveBeenCalledTimes(80);
    expect(r.notices.filter((n) => n.code === 'LIMIT').length).toBeGreaterThanOrEqual(2);
    for (const call of f.tx.stockMovement.groupBy.mock.calls)
      expect(call[0].where.tenantId).toBe('tenant');
  });
  it('preserves a valid earlier path at convergence and applies movement chronology', async () => {
    const f = fixture();
    const at = (n: number) => `2026-09-25T${String(n).padStart(2, '0')}:00:00Z`;
    const defs: Record<string, any> = {
      a: ['root', 'shared', 14],
      b: ['root', 'shared', 10],
      c: ['shared', 'end', 12],
    };
    f.tx.stockMovement.groupBy.mockImplementation(async ({ where }: any) =>
      where.lotId === 'root'
        ? [{ refId: 'a' }, { refId: 'b' }]
        : where.lotId === 'shared'
          ? [{ refId: 'c' }]
          : [],
    );
    jest
      .spyOn(f.service as any, 'declaration')
      .mockImplementation(async (_tx: any, _tenant: any, id: any) => ({
        order: { id: 'order', number: 'OF' },
        reversed: false,
        movements: [
          f.movement(`i${id}`, defs[id][0], 'CONSUMPTION', at(defs[id][2])),
          f.movement(`o${id}`, defs[id][1], 'PRODUCTION', at(defs[id][2])),
        ],
      }));
    const r = await f.service.trace(f.user, 'item', 'root', new LotTraceQueryDto());
    expect(r.nodes.map((n) => n.id)).toContain('end');
    expect(r.edges).toHaveLength(3);
    expect(r.notices.some((n) => n.code === 'CHRONOLOGY')).toBe(true);
  });
  it('never queries or exposes shipment metadata without both module and permission', async () => {
    const f = fixture();
    const query = new LotTraceDossiersDto();
    const hidden = await f.service.dossiers(
      { ...f.user, permissions: ['wms.read'] },
      'item',
      'lot',
      query,
    );
    expect(hidden.items[0]).not.toHaveProperty('context');
    expect(f.tx.shipment.findMany).not.toHaveBeenCalled();
    const visible = await f.service.dossiers(f.user, 'item', 'lot', query);
    expect(visible.items[0].context).toEqual({
      label: 'SH-1',
      href: '/shipments?shipment=shipment',
    });
    expect(f.tx.shipment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 'tenant', id: { in: ['shipment'] } } }),
    );
    f.tx.shipment.findMany.mockClear();
    f.modules.getEnabledKeys.mockResolvedValue(new Set(['wms']));
    const disabled = await f.service.dossiers(f.user, 'item', 'lot', query);
    expect(disabled.items[0]).not.toHaveProperty('context');
    expect(f.tx.shipment.findMany).not.toHaveBeenCalled();
  });
  it('does not query manufacturing when its module is disabled even with permissions', async () => {
    const f = fixture();
    f.modules.getEnabledKeys.mockResolvedValue(new Set(['wms']));
    const r = await f.service.trace(f.user, 'item', 'root', new LotTraceQueryDto());
    expect(r.scopes.manufacturing).toBe(false);
    expect(r.nodes).toHaveLength(1);
    expect(f.tx.stockMovement.groupBy).not.toHaveBeenCalled();
  });
});
