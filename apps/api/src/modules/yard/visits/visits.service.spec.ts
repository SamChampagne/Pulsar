import { YardVisitStatus } from '@pulsar/shared';
import { VisitsService } from './visits.service';

function harness(opts: { occupied?: boolean } = {}) {
  const visit: any = { id: 'v1', tenantId: 't1', status: YardVisitStatus.CHECKED_IN, spotId: null };
  const moves: any[] = [];
  const client = {
    yardVisit: {
      findFirst: async () => visit,
      count: async ({ where }: any) => (opts.occupied && where.spotId === 'door1' ? 1 : 0),
      updateMany: async ({ where, data }: any) => {
        const ok =
          where.status === undefined ||
          where.status === visit.status ||
          (where.status?.in ?? []).includes(visit.status);
        if (ok) {
          Object.assign(visit, data);
          return { count: 1 };
        }
        return { count: 0 };
      },
    },
    yardMove: {
      create: async ({ data }: any) => {
        moves.push(data);
        return { id: 'm' + moves.length, ...data };
      },
    },
    $transaction: async (fn: any) => fn(client),
  } as any;
  const sequences = { nextNumber: async () => 'YV-0001' } as any;
  const ownership = { assertOwnedIfSet: async () => undefined } as any;
  const audit = { log: async () => undefined } as any;
  return { svc: new VisitsService(client, sequences, ownership, audit), visit, moves };
}

describe('VisitsService.assign', () => {
  it('assigns a free spot: writes a YardMove + flips to ASSIGNED + sets spotId', async () => {
    const h = harness();
    await h.svc.assign('t1', 'u1', 'v1', { spotId: 'door1' } as any);
    expect(h.visit.status).toBe(YardVisitStatus.ASSIGNED);
    expect(h.visit.spotId).toBe('door1');
    expect(h.moves[0].toSpotId).toBe('door1');
  });
  it('rejects assigning an occupied spot', async () => {
    const h = harness({ occupied: true });
    await expect(h.svc.assign('t1', 'u1', 'v1', { spotId: 'door1' } as any)).rejects.toThrow();
  });
});

describe('VisitsService.checkOut', () => {
  it('flips to DEPARTED, frees the spot, logs a move', async () => {
    const h = harness();
    h.visit.spotId = 'door1';
    h.visit.status = YardVisitStatus.ASSIGNED;
    await h.svc.checkOut('t1', 'u1', 'v1');
    expect(h.visit.status).toBe(YardVisitStatus.DEPARTED);
    expect(h.visit.spotId).toBeNull();
    expect(h.moves.at(-1).toSpotId).toBeNull();
  });
});
