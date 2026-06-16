import { SpotsService } from './spots.service';

function layoutHarness() {
  const updated: any[] = [];
  const prisma = {
    yardSpot: {
      updateMany: async ({ where, data }: any) => {
        updated.push({ id: where.id, tenantId: where.tenantId, ...data });
        return { count: where.tenantId === 't1' ? 1 : 0 };
      },
    },
    $transaction: async (ops: any) => {
      if (typeof ops === 'function') return ops(prisma);
      return Promise.all(ops);
    },
  } as any;
  const ownership = {} as any;
  return { svc: new SpotsService(prisma, ownership), updated };
}

describe('SpotsService.updateLayout', () => {
  it('persists posX/posY for each spot, tenant-scoped', async () => {
    const h = layoutHarness();
    await h.svc.updateLayout('t1', 'u1', [
      { id: 's1', posX: 0, posY: 1 },
      { id: 's2', posX: 2, posY: 0 },
    ] as any);
    expect(h.updated).toHaveLength(2);
    expect(h.updated[0]).toMatchObject({ id: 's1', tenantId: 't1', posX: 0, posY: 1 });
  });
});
