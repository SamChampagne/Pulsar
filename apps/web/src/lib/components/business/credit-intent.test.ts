import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readCreditIntent, rememberCreditIntent, type CreditIntent } from './credit-intent';
const intent: CreditIntent = {
  operationKey: '72663d0a-716c-4c92-8d8c-8c8978a684a3',
  expectedVersion: 0,
  reason: 'Retour',
  lines: [{ invoiceLineId: 'line', quantity: 0.375 }],
};
describe('Credit draft persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });
  it('retains the exact invoice-line quantities and blocks overwrite', () => {
    rememberCreditIntent('tenant:user:invoice', intent);
    expect(readCreditIntent('tenant:user:invoice')).toEqual(intent);
    expect(readCreditIntent('tenant:user:other')).toBeNull();
    expect(() => rememberCreditIntent('tenant:user:invoice', intent)).toThrow();
  });
  it('fails closed on corrupt content or unavailable storage', () => {
    for (const v of [
      '{',
      JSON.stringify({ ...intent, lines: [{ invoiceLineId: 'line', quantity: -1 }] }),
      JSON.stringify({ ...intent, expectedVersion: -1 }),
    ]) {
      localStorage.setItem('key', v);
      expect(() => readCreditIntent('key')).toThrow('illisible');
    }
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota');
    });
    expect(() => rememberCreditIntent('new', intent)).toThrow('Aucun avoir envoyé');
  });
});
