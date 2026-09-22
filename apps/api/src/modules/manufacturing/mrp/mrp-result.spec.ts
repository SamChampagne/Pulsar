import { MrpSourcingMethod, type MrpSnapshot } from '@pulsar/shared';
import { validateMrpResult } from './mrp-result';

const input: MrpSnapshot = {
  version: 'pulsar.mrp.v1',
  as_of: '2026-09-15',
  horizon_end: '2026-09-30',
  items: [
    {
      id: 'a',
      sku: 'A',
      name: 'A',
      unit: 'KG',
      method: MrpSourcingMethod.BUY,
      on_hand: '1',
      safety_stock: '0',
      minimum_order: '0',
      order_multiple: '1',
      lead_days: 0,
      components: [],
    },
  ],
  demands: [],
  supplies: [],
};
const result = () => ({
  tenant_id: 'tenant',
  version: input.version,
  engine_revision: 'planiadvance-d26a8cd.pulsar-mrp1',
  as_of: input.as_of,
  horizon_end: input.horizon_end,
  proposals: [],
  exceptions: [],
  assumptions: [],
  items: [
    {
      item_id: 'a',
      sku: 'A',
      name: 'A',
      unit: 'KG',
      method: 'BUY',
      on_hand: '1',
      level: 0,
      gross_requirement: '0',
      planned_receipts: '0',
      projected_end: '1',
      timeline: [],
    },
  ],
});
describe('MRP bridge result validation', () => {
  it('accepts exact decimal-string contract', () =>
    expect(validateMrpResult(result(), 'tenant', input).items[0].on_hand).toBe('1'));
  it('rejects tenant substitution', () =>
    expect(() => validateMrpResult(result(), 'other', input)).toThrow());
  it('rejects missing or duplicated articles', () => {
    const data = result();
    data.items.push(data.items[0]);
    expect(() => validateMrpResult(data, 'tenant', input)).toThrow();
    expect(() => validateMrpResult({ ...result(), items: [] }, 'tenant', input)).toThrow();
  });
  it('rejects unit substitution and numeric/NaN quantities', () => {
    const data = result();
    data.items[0].unit = 'LB';
    expect(() => validateMrpResult(data, 'tenant', input)).toThrow();
    data.items[0].unit = 'KG';
    data.items[0].on_hand = 'NaN';
    expect(() => validateMrpResult(data, 'tenant', input)).toThrow();
    (data.items[0] as any).on_hand = 1;
    expect(() => validateMrpResult(data, 'tenant', input)).toThrow();
  });
  it('rejects wrong horizons and unknown versions', () => {
    expect(() =>
      validateMrpResult({ ...result(), horizon_end: '2027-01-01' }, 'tenant', input),
    ).toThrow();
    expect(() =>
      validateMrpResult({ ...result(), engine_revision: 'unknown' }, 'tenant', input),
    ).toThrow();
  });
});
