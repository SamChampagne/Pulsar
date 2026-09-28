import { beforeEach, describe, it, expect, vi } from 'vitest';
import {
  readStockExitIntent,
  rememberStockExitIntent,
  type StockExitIntent,
} from './stock-exit-intent';
const key = 'pulsar:stock-exit:tenant:user';
const create: StockExitIntent = {
  action: 'create',
  body: {
    operationKey: 'ed2685e9-1737-4eb1-846f-dfd277aa46b9',
    kind: 'DISPOSAL',
    itemId: 'item',
    lotId: 'lot',
    binId: 'bin',
    quantity: '2.125',
    reason: 'Matière endommagée',
  },
};
beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});
describe('durable documented stock exit requests', () => {
  it('captures exact create, post and cancel payloads independently by scope', () => {
    const post: StockExitIntent = {
      action: 'post',
      id: 'exit',
      body: {
        operationKey: create.body.operationKey,
        expectedUpdatedAt: '2026-09-25T12:00:00.000Z',
        reviewToken: 'a'.repeat(64),
        completionNote: 'Sortie physique vérifiée',
        confirmed: true,
      },
    };
    const cancel: StockExitIntent = {
      action: 'cancel',
      id: 'exit',
      body: {
        operationKey: create.body.operationKey,
        expectedUpdatedAt: post.body.expectedUpdatedAt,
        reason: 'Erreur de lot',
      },
    };
    const linkedReturn: StockExitIntent = {
      ...create,
      body: {
        ...create.body,
        kind: 'SUPPLIER_RETURN',
        supplierId: 'supplier',
        reference: 'RMA-42',
        destination: '100 rue Fournisseur, Québec',
        purchaseSourceId: 'receipt-line',
        purchaseSourceToken: 'b'.repeat(64),
      },
    };
    for (const p of [create, linkedReturn, post, cancel]) {
      localStorage.clear();
      rememberStockExitIntent(key, p);
      expect(readStockExitIntent(key)).toEqual(p);
      expect(readStockExitIntent(key + 'other')).toBeNull();
      expect(() => rememberStockExitIntent(key, p)).not.toThrow();
    }
  });
  it('never overwrites an unresolved request or erases corrupt evidence', () => {
    rememberStockExitIntent(key, create);
    expect(() =>
      rememberStockExitIntent(key, { ...create, body: { ...create.body, quantity: '3' } }),
    ).toThrow(/attend/);
    for (const raw of [
      '{',
      JSON.stringify({ ...create, body: { ...create.body, quantity: '-2' } }),
      JSON.stringify({ ...create, body: { ...create.body, kind: 'SUPPLIER_RETURN' } }),
      JSON.stringify({
        ...create,
        body: {
          ...create.body,
          purchaseSourceId: 'receipt-line',
          purchaseSourceToken: 'b'.repeat(64),
        },
      }),
      JSON.stringify({
        ...create,
        body: {
          ...create.body,
          kind: 'SUPPLIER_RETURN',
          supplierId: 'supplier',
          reference: 'RMA-42',
          destination: '100 rue Fournisseur, Québec',
          purchaseSourceId: 'receipt-line',
        },
      }),
    ]) {
      localStorage.setItem(key, raw);
      expect(() => readStockExitIntent(key)).toThrow();
      expect(localStorage.getItem(key)).toBe(raw);
    }
  });
  it('rejects unavailable storage before dispatch', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw Error('quota');
    });
    expect(() => rememberStockExitIntent(key, create)).toThrow(/Aucune sortie envoyée/);
  });
});
