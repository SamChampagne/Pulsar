import { describe, expect, it } from 'vitest';
import { deriveDemandCoverage, type PlanningDemand } from './demand-coverage';
const forecast: PlanningDemand = {
  id: 'f',
  itemId: 'i',
  locationId: 's',
  kind: 'FORECAST',
  quantity: '100',
  dueDate: '2026-10-31',
  forecastStart: '2026-10-01',
  reference: 'October',
  isActive: true,
};
const order: PlanningDemand = {
  ...forecast,
  id: 'd',
  kind: 'DEMAND',
  quantity: '30',
  dueDate: '2026-10-12',
  forecastId: 'f',
  reference: 'SO-1',
};
describe('Explicit forecast consumption', () => {
  it('replaces rather than adds a firm demand to its forecast', () => {
    const result = deriveDemandCoverage([forecast, order]);
    expect(result.demands.map((d) => d.quantity)).toEqual(['30', '70']);
    expect(result.forecasts[0].consumed).toBe('30');
  });
  it('keeps fulfilled demand consumed, restores cancelled demand', () => {
    expect(
      deriveDemandCoverage([forecast, { ...order, state: 'FULFILLED' }]).demands.map(
        (d) => d.quantity,
      ),
    ).toEqual(['70']);
    expect(
      deriveDemandCoverage([forecast, { ...order, state: 'CANCELLED' }]).demands.map(
        (d) => d.quantity,
      ),
    ).toEqual(['100']);
  });
  it('preserves independent demand and inactive forecasts', () => {
    expect(
      deriveDemandCoverage([forecast, { ...order, forecastId: null }]).demands.map(
        (d) => d.quantity,
      ),
    ).toEqual(['30', '100']);
    expect(
      deriveDemandCoverage([{ ...forecast, isActive: false }, order]).demands.map(
        (d) => d.quantity,
      ),
    ).toEqual(['30']);
  });
  it('caps consumed forecast but never drops excess firm demand', () => {
    const result = deriveDemandCoverage([forecast, { ...order, quantity: '120' }]);
    expect(result.demands.map((d) => d.quantity)).toEqual(['120']);
    expect(result.forecasts[0].remaining).toBe('0');
  });
  it('uses exact decimals with deterministic consumption order', () => {
    const entries = [
      { ...forecast, quantity: '0.3' },
      { ...order, quantity: '0.1' },
      { ...order, id: 'd2', quantity: '0.2' },
    ];
    expect(deriveDemandCoverage(entries).forecasts[0].remaining).toBe('0');
    expect(deriveDemandCoverage([...entries].reverse())).toEqual(deriveDemandCoverage(entries));
  });
  it('refuses cross-site/item/period mappings', () => {
    for (const change of [{ locationId: 'other' }, { itemId: 'other' }, { dueDate: '2026-11-01' }])
      expect(() => deriveDemandCoverage([forecast, { ...order, ...change }])).toThrow(
        'Incompatible',
      );
  });
});
