import { ReceiptStatus } from '@pulsar/shared';
import { ReceivingService } from './receiving.service';

function harness() {
  const receipt: any = {
    id: 'r1',
    tenantId: 't1',
    status: ReceiptStatus.DRAFT,
    locationId: 'loc1',
    lines: [{ id: 'l1', itemId: 'i1', toBinId: 'b1', qty: 7 }],
  };
  const posted: any[] = [];
  const client = {
    receipt: {
      findFirst: async () => receipt,
      updateMany: async ({ where, data }: any) => {
        if (where.status === receipt.status) {
          Object.assign(receipt, data);
          return { count: 1 };
        }
        return { count: 0 };
      },
    },
    $transaction: async (fn: any) => fn(client),
  } as any;
  const inventory = {
    postMovement: async (_tx: any, a: any) => {
      posted.push(a);
    },
  } as any;
  const sequences = { nextNumber: async () => 'RC-0001' } as any;
  const ownership = { assertOwnedIfSet: async () => undefined } as any;
  const audit = { log: async () => undefined } as any;
  const domainEvents = { emit: async () => undefined } as any;
  return { svc: new ReceivingService(client, inventory, sequences, ownership, audit, domainEvents), receipt, posted };
}

describe('ReceivingService.post', () => {
  it('posts each line as a RECEIPT movement and flips DRAFT→POSTED', async () => {
    const h = harness();
    await h.svc.post('t1', 'u1', 'r1');
    expect(h.receipt.status).toBe(ReceiptStatus.POSTED);
    expect(h.posted).toHaveLength(1);
    expect(h.posted[0].toBinId).toBe('b1');
    expect(h.posted[0].qty).toBe(7);
  });
});
