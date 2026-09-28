// @vitest-environment jsdom
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { readLedgerIntent as read, rememberLedgerIntent as remember } from './ledger-intent';
const key = 'ledger:tenant:user';
const input = () => ({
  operationKey: '12345678-1234-4234-8234-123456789012',
  currency: 'CAD',
  date: '2026-09-27',
  memo: 'Exact request',
  lines: [
    { accountCode: '1000', debit: '0.30' },
    { accountCode: '4000', credit: '0.30' },
  ],
});
describe('ledger durable request', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });
  it('retains exact key/body across retries and isolates users', () => {
    remember(key, input());
    remember(key, input());
    expect(read(key)).toEqual(input());
    expect(read('ledger:tenant:other')).toBeNull();
  });
  it('never replaces uncertain request', () => {
    remember(key, input());
    expect(() => remember(key, { ...input(), currency: 'USD' })).toThrow();
    expect(read(key)).toEqual(input());
  });
  it.each([
    'null',
    '{}',
    '{',
    JSON.stringify({ ...input(), currency: 'ZZZ' }),
    JSON.stringify({ ...input(), date: '2026-02-30' }),
    JSON.stringify({ ...input(), lines: [] }),
  ])('rejects corrupt state %s', (raw) => {
    localStorage.setItem(key, raw);
    expect(() => read(key)).toThrow();
  });
  it('refuses sending when persistence fails', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw Error('quota');
    });
    expect(() => remember(key, input())).toThrow('Rien n’a été envoyé');
  });
});
