import { beforeEach, describe, it, expect, vi } from 'vitest';
import {
  readReceiptIntent,
  rememberReceiptIntent,
  clearReceiptIntent,
  type ReceiptIntent,
} from './receipt-intent';
describe('Durable supplier receipt intent', () => {
  beforeEach(() => localStorage.clear());
  const value: ReceiptIntent = {
    orderId: 'o1',
    body: {
      operationKey: '12345678-1234-4123-8123-123456789abc',
      expectedUpdatedAt: '2026-09-22T00:00:00Z',
      locationId: 's1',
      reference: 'BL01',
      lines: [{ orderLineId: 'l1', binId: 'b1', quantity: 2.5 }],
    },
  };
  it('preserves the exact body and isolates tenant, actor and order', () => {
    rememberReceiptIntent('t:u:o', value);
    expect(readReceiptIntent('t:u:o')).toEqual(value);
    expect(readReceiptIntent('other:u:o')).toBeNull();
    expect(() => rememberReceiptIntent('t:u:o', value)).toThrow();
    clearReceiptIntent('t:u:o', 'other');
    expect(readReceiptIntent('t:u:o')).not.toBeNull();
    clearReceiptIntent('t:u:o', value.body.operationKey);
    expect(readReceiptIntent('t:u:o')).toBeNull();
  });
  it('fails closed on corrupt storage and quota failures', () => {
    localStorage.setItem('pulsar.purchasing.receipts.v1:bad', '{}');
    expect(() => readReceiptIntent('bad')).toThrow();
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => rememberReceiptIntent('new', value)).toThrow();
    spy.mockRestore();
  });
  it('preserves optional package counts verbatim and refuses malformed stored counts', () => {
    const packaged = {
      ...value,
      body: { ...value.body, lines: [{ ...value.body.lines[0], packageCount: '2.0000' }] },
    };
    rememberReceiptIntent('packages', packaged);
    expect(readReceiptIntent('packages')).toEqual(packaged);
    for (const packageCount of ['1e2', '-1', 2, null]) {
      localStorage.setItem(
        'pulsar.purchasing.receipts.v1:corrupt',
        JSON.stringify({
          ...packaged,
          body: { ...packaged.body, lines: [{ ...packaged.body.lines[0], packageCount }] },
        }),
      );
      expect(() => readReceiptIntent('corrupt')).toThrow();
    }
  });
  it('preserves the selected lot and rejects corrupt lot references on recovery', () => {
    const request = {
      ...value,
      body: { ...value.body, lines: [{ ...value.body.lines[0], lotId: 'lot-001' }] },
    };
    rememberReceiptIntent('lot', request);
    expect(readReceiptIntent('lot')).toEqual(request);
    for (const lotId of ['', null, 3]) {
      localStorage.setItem(
        'pulsar.purchasing.receipts.v1:bad-lot',
        JSON.stringify({
          ...request,
          body: { ...request.body, lines: [{ ...request.body.lines[0], lotId }] },
        }),
      );
      expect(() => readReceiptIntent('bad-lot')).toThrow();
    }
  });
});
