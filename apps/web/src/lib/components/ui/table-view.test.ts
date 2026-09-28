import { expect, it } from 'vitest';
import { normalizeTableView } from './table-view';
it('drops stale keys, preserves required columns and bounds hostile widths', () => {
  expect(
    normalizeTableView(
      { hidden: ['name', 'contact', 'old'], widths: { name: -5, contact: Infinity, old: 90 } },
      [
        { key: 'name', label: 'Nom', required: true },
        { key: 'contact', label: 'Contact', width: 220 },
      ],
    ),
  ).toEqual({ hidden: ['contact'], widths: { name: 100, contact: 220 } });
});
it('recovers corrupt or fully hidden views', () => {
  const columns = [{ key: 'name', label: 'Nom' }];
  expect(normalizeTableView(null, columns).hidden).toEqual([]);
  expect(normalizeTableView({ hidden: ['name'] }, columns).hidden).toEqual([]);
});
