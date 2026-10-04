import { describe, expect, it } from 'vitest';
import { fuelOperationStorageKey, parseFuelIntent } from './fuel-operation';

const base = '/transportation/delivery-fuel';
const intent = {
  kind: 'price',
  endpoint: `${base}/prices`,
  body: {
    operationKey: 'a11ac885-ae38-4ba1-832f-f0adf6733e75',
    expectedRevision: 2,
    price: {
      effectiveOn: '2026-10-01',
      pricePerLitre: '1.6500',
      currency: 'CAD',
      reference: 'Prix local déclaré',
    },
  },
};
describe('fuel operation recovery', () => {
  it('restores exactly the saved intent including noncanonical decimal spelling', () => {
    expect(parseFuelIntent(JSON.stringify(intent), 'l')).toEqual(intent);
  });
  it('separates storage by tenant/actor/load', () => {
    expect(fuelOperationStorageKey('t:u:l')).not.toBe(fuelOperationStorageKey('t:v:l'));
    expect(fuelOperationStorageKey('t:u:l')).not.toBe(fuelOperationStorageKey('other:u:l'));
  });
  it.each([
    { endpoint: '/platform/secrets' },
    { kind: 'other' },
    { unexpected: 1 },
    { body: { ...intent.body, operationKey: 'not-uuid' } },
    { body: { ...intent.body, expectedRevision: -1 } },
    { body: { ...intent.body, tenantId: 'other' } },
  ])('rejects altered shape or endpoint %j', (change) => {
    expect(() => parseFuelIntent(JSON.stringify({ ...intent, ...change }), 'l')).toThrow();
  });
  it('restores actual only for this load, keeping both versions and measured body', () => {
    const actual = {
      kind: 'actual',
      endpoint: `${base}/loads/l/actuals`,
      body: {
        operationKey: intent.body.operationKey,
        expectedRevision: 1,
        expectedLoadUpdatedAt: '2026-10-01T00:00:00Z',
        expectedRouteUpdatedAt: '2026-09-30T00:00:00Z',
        actual: {
          distanceKm: '100',
          consumedLitres: '30',
          costAmount: null,
          currency: null,
          measuredAt: '2026-10-01T01:00:00Z',
          note: 'Compteur manuel',
        },
      },
    };
    expect(parseFuelIntent(JSON.stringify(actual), 'l')).toEqual(actual);
    expect(() => parseFuelIntent(JSON.stringify(actual), 'other')).toThrow();
  });
  it('rejects malformed storage and invalid profile values', () => {
    expect(() => parseFuelIntent('not json', 'l')).toThrow();
    expect(() =>
      parseFuelIntent(
        JSON.stringify({
          ...intent,
          kind: 'profile',
          endpoint: `${base}/vehicles/v/profile`,
          body: { ...intent.body, profile: {} },
        }),
        'l',
      ),
    ).toThrow();
  });
});
