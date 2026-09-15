import { describe, expect, it } from 'vitest';
import { groupWmsBins, type WmsVisualBin } from './workspace';
const bin = (id: string, kind: string, zone: string | null): WmsVisualBin => ({
  id,
  code: id,
  kind,
  zone,
  isActive: true,
  stockedItems: 0,
  negativeItems: 0,
});
describe('warehouse schematic grouping', () => {
  it('separates operational kinds even when they share a zone name', () => {
    const groups = groupWmsBins([bin('b', 'STORAGE', 'Nord'), bin('a', 'RECEIVING', 'Nord')]);
    expect(groups.map((g) => g.kind)).toEqual(['RECEIVING', 'STORAGE']);
    expect(new Set(groups.map((g) => g.key)).size).toBe(2);
  });
  it('groups unzoned bins without deriving geography from codes', () => {
    const groups = groupWmsBins([bin('A-1', 'STORAGE', null), bin('B-1', 'STORAGE', '')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Sans zone');
    expect(groups[0].bins).toHaveLength(2);
  });
  it('does not mutate inputs or interpret inactive stock as available capacity', () => {
    const b = { ...bin('off', 'STORAGE', 'Nord'), isActive: false, stockedItems: 2 };
    const input = Object.freeze([Object.freeze(b)]);
    const groups = groupWmsBins([...input]);
    expect(groups[0].bins[0]).toEqual(b);
    expect(groups[0]).not.toHaveProperty('capacity');
  });
});
