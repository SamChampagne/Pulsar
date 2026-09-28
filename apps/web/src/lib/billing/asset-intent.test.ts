import { beforeEach, describe, it, expect } from 'vitest';
import {
  readAssetIntent,
  rememberAssetIntent,
  validateAssetIntent,
  type AssetIntent,
} from './asset-intent';
const p: AssetIntent = {
  path: '/billing/fixed-assets/test/depreciate',
  method: 'POST',
  body: {
    operationKey: '12345678-1234-4123-8123-123456789012',
    expectedVersion: 2,
    confirmed: true,
    period: '2026-01',
  },
};
describe('asset intents', () => {
  beforeEach(() => localStorage.clear());
  it('retains exact request, tenant/user isolation and refuses replacement', () => {
    rememberAssetIntent('t:u', p);
    expect(readAssetIntent('t:u')).toEqual(p);
    expect(readAssetIntent('t:other')).toBeNull();
    expect(() =>
      rememberAssetIntent('t:u', { ...p, body: { ...p.body, period: '2026-02' } }),
    ).toThrow();
  });
  it('rejects untrusted actions, unexpected financial amounts and malformed months', () => {
    for (const change of [
      { path: '/users' },
      { method: 'DELETE' },
      { path: '/billing/fixed-assets/test/depreciate/other' },
      { body: { ...p.body, amount: '123' } },
      { body: { ...p.body, expectedVersion: 0 } },
      { body: { ...p.body, confirmed: false } },
      { body: { ...p.body, period: '2026-13' } },
    ])
      expect(() => validateAssetIntent({ ...p, ...change } as AssetIntent)).toThrow();
  });
  it('keeps corrupted stored requests blocked rather than silently dropping them', () => {
    localStorage.setItem('t:u', '{');
    expect(() => readAssetIntent('t:u')).toThrow('illisible');
    expect(localStorage.getItem('t:u')).toBe('{');
  });
  it('validates complete create, update, activation and withdrawal contracts', () => {
    const create: AssetIntent = {
      path: '/billing/fixed-assets',
      method: 'POST',
      body: {
        operationKey: p.body.operationKey,
        assetCode: 'A',
        name: 'Asset',
        category: '',
        acquisitionReference: '',
        currency: 'CAD',
        cost: '0.01',
        salvageValue: '0',
        usefulLifeMonths: 3,
        acquisitionDate: '2026-01-01',
        depreciationStartMonth: '2026-01',
        depreciationExpenseAccountCode: '5100',
        accumulatedDepreciationAccountCode: '1590',
      },
    };
    expect(validateAssetIntent(create)).toEqual(create);
    expect(() =>
      validateAssetIntent({ ...create, body: { ...create.body, cost: '1.001' } }),
    ).toThrow();
    expect(
      validateAssetIntent({
        ...create,
        path: '/billing/fixed-assets/A',
        method: 'PATCH',
        body: { ...create.body, expectedVersion: 1 },
      }),
    ).toBeTruthy();
    expect(() => validateAssetIntent({ ...p, path: '/billing/fixed-assets/A/activate' })).toThrow();
    expect(
      validateAssetIntent({
        ...p,
        path: '/billing/fixed-assets/A/activate',
        body: {
          operationKey: p.body.operationKey,
          expectedVersion: 1,
          confirmed: true,
          reviewToken: 'a'.repeat(64),
        },
      }),
    ).toBeTruthy();
    expect(() =>
      validateAssetIntent({
        ...p,
        path: '/billing/fixed-assets/A/dispose',
        body: {
          operationKey: p.body.operationKey,
          expectedVersion: 1,
          confirmed: true,
          reason: '  ',
        },
      }),
    ).toThrow();
  });
});
