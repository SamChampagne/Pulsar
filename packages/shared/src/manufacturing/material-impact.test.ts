import { describe, expect, it } from 'vitest';
import { deriveMaterialImpact } from './material-impact';
describe('advisory material allocation', () => {
  const order = (id: string, qty = '2') => ({
    id,
    dueDate: '2026-10-10',
    targetDate: '2026-10-01',
    components: [{ itemId: 'steel', quantity: qty }],
  });
  it('never allocates the same stock to two orders, using stable priorities', () => {
    const result = deriveMaterialImpact({
      today: '2026-10-01',
      stocks: [{ itemId: 'steel', quantity: '3' }],
      arrivals: [],
      orders: [order('b'), order('a')],
    });
    expect(result[0]).toMatchObject({ id: 'a', state: 'READY', delayDays: 0 });
    expect(result[1].components[0].shortage).toBe('1');
  });
  it('dates an arrival without counting overdue promises as stock', () => {
    const result = deriveMaterialImpact({
      today: '2026-10-01',
      stocks: [],
      arrivals: [
        { id: 'old', itemId: 'steel', quantity: '500', expectedDate: '2026-09-30' },
        { id: 'new', itemId: 'steel', quantity: '2', expectedDate: '2026-10-04' },
      ],
      orders: [order('a')],
    });
    expect(result[0]).toMatchObject({ state: 'WAITING', readyDate: '2026-10-04', delayDays: 3 });
    expect(result[0].components[0].sources[0].purchaseId).toBe('new');
  });
  it('preserves 9 decimal places and never sums different items', () => {
    const result = deriveMaterialImpact({
      today: '2026-10-01',
      stocks: [
        { itemId: 'steel', quantity: '0.000000001' },
        { itemId: 'wood', quantity: '100' },
      ],
      arrivals: [],
      orders: [order('a', '0.000000003')],
    });
    expect(result[0].components[0].shortage).toBe('0.000000002');
    expect(result[0].readyDate).toBeNull();
  });
});
