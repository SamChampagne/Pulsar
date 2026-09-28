import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readSupplierCreditIntent as read,
  rememberSupplierCreditIntent as remember,
  type SupplierCreditIntent,
} from './supplier-credit-intent';
const p: SupplierCreditIntent = {
  method: 'POST',
  path: '/billing/supplier-credits',
  body: {
    operationKey: '12345678-1234-4234-8234-123456789abc',
    externalNumber: 'FV-123',
    lines: [{ netAmount: '0.10' }],
  },
};
describe('supplier invoice durable requests', () => {
  const data = new Map<string, string>();
  beforeEach(() => {
    data.clear();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => data.set(k, v),
    });
  });
  it('preserves exact method, body and key without changing cents', () => {
    remember('tenant:user', p);
    expect(read('tenant:user')).toEqual(p);
    remember('tenant:user', p);
    expect(read('other:user')).toBeNull();
  });
  it('refuses replacing an unresolved operation', () => {
    remember('k', p);
    expect(() => remember('k', { ...p, body: { ...p.body, externalNumber: 'changed' } })).toThrow();
    expect(read('k')).toEqual(p);
  });
  it.each([
    { method: 'DELETE' },
    { path: '/billing/payments' },
    { path: '/billing/supplier-credits/../../users' },
    { path: 'https://foreign.test' },
    { body: { operationKey: 'not-uuid' } },
  ])('rejects corrupted request %j', (patch) => {
    data.set('k', JSON.stringify({ ...p, ...patch }));
    expect(() => read('k')).toThrow();
  });
  it('does not send if local persistence fails', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw Error();
      },
    });
    expect(() => remember('k', p)).toThrow('Rien n’a été envoyé');
  });
});
