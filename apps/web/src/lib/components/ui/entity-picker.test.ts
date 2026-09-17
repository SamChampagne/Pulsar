import { describe, it, expect } from 'vitest';
import { formatItem, filterArray } from './entity-picker';

describe('formatItem', () => {
  it('reads the label from the default `name` key', () => {
    expect(formatItem({ id: '1', name: 'Centre Laval' })).toEqual({ label: 'Centre Laval' });
  });

  it('reads the label from an explicit key (bins have `code`, not `name`)', () => {
    expect(formatItem({ id: '1', code: 'R-01', zone: 'Réception' }, 'code')).toEqual({
      label: 'R-01',
    });
  });

  it('adds the detail when `detailKey` is given and the value is non-empty', () => {
    expect(formatItem({ id: '1', code: 'R-01', zone: 'Réception' }, 'code', 'zone')).toEqual({
      label: 'R-01',
      detail: 'Réception',
    });
  });

  it('omits the detail when the detail value is missing, empty or blank', () => {
    expect(formatItem({ code: 'R-01', zone: '' }, 'code', 'zone').detail).toBeUndefined();
    expect(formatItem({ code: 'R-01', zone: '   ' }, 'code', 'zone').detail).toBeUndefined();
    expect(formatItem({ code: 'R-01' }, 'code', 'zone').detail).toBeUndefined();
    expect(formatItem({ code: 'R-01', zone: null }, 'code', 'zone').detail).toBeUndefined();
  });

  it('joins several keys when `labelKey` holds whitespace-separated keys (driver names)', () => {
    expect(formatItem({ firstName: 'Ada', lastName: 'Lovelace' }, 'firstName lastName')).toEqual({
      label: 'Ada Lovelace',
    });
  });

  it('skips missing parts of a composite label instead of leaving a gap', () => {
    expect(formatItem({ firstName: 'Ada', lastName: '' }, 'firstName lastName').label).toBe('Ada');
    expect(formatItem({ lastName: 'Lovelace' }, 'firstName lastName').label).toBe('Lovelace');
  });

  it('falls back to the usual identifying keys when the requested key is absent', () => {
    // A vehicle endpoint exposes `unitNumber`, not `name` — a caller that forgot
    // labelKey must still see something, never an empty row.
    expect(formatItem({ id: 'v1', unitNumber: 'T-402' }).label).toBe('T-402');
    expect(formatItem({ id: 'l1', code: 'LAV' }).label).toBe('LAV');
    expect(formatItem({ id: 'x1', label: 'Libellé' }).label).toBe('Libellé');
    expect(formatItem({ id: 'x1', sku: 'VIS-10' }).label).toBe('VIS-10');
  });

  it('never returns an empty label when the item carries nothing but an id', () => {
    expect(formatItem({ id: 'abc' }).label).toBe('abc');
  });

  it('returns an empty label rather than throwing on an empty or non-object item', () => {
    expect(formatItem({}).label).toBe('');
    expect(formatItem(null as unknown as Record<string, unknown>).label).toBe('');
  });

  it('stringifies numeric values and trims strings', () => {
    expect(formatItem({ name: '  Centre  ' }).label).toBe('Centre');
    expect(formatItem({ name: 42 }).label).toBe('42');
    expect(formatItem({ code: 'A', qty: 0 }, 'code', 'qty').detail).toBe('0');
  });

  it('ignores object and boolean values instead of rendering [object Object]', () => {
    expect(formatItem({ name: { fr: 'Centre' } }).label).toBe('');
    expect(formatItem({ name: true }).label).toBe('');
  });
});

describe('filterArray', () => {
  const accounts = [
    { code: '1000', name: 'Encaisse' },
    { code: '1200', name: 'Comptes clients' },
    { code: '5100', name: 'Dotation aux amortissements' },
  ];

  it('returns every item for an empty or blank query', () => {
    expect(filterArray(accounts, '', ['code', 'name'])).toEqual(accounts);
    expect(filterArray(accounts, '   ', ['code', 'name'])).toEqual(accounts);
  });

  it('matches a substring on any of the given keys', () => {
    expect(filterArray(accounts, '12', ['code', 'name'])).toEqual([accounts[1]]);
    expect(filterArray(accounts, 'clients', ['code', 'name'])).toEqual([accounts[1]]);
  });

  it('ignores case and accents', () => {
    expect(filterArray(accounts, 'ENCAISSE', ['code', 'name'])).toEqual([accounts[0]]);
    expect(filterArray(accounts, 'amortissements', ['code', 'name'])).toEqual([accounts[2]]);
    expect(filterArray([{ name: 'Québec' }], 'quebec', ['name'])).toHaveLength(1);
    expect(filterArray([{ name: 'Quebec' }], 'québec', ['name'])).toHaveLength(1);
  });

  it('preserves the source order and returns an empty list when nothing matches', () => {
    expect(filterArray(accounts, '0', ['code'])).toEqual([accounts[0], accounts[1], accounts[2]]);
    expect(filterArray(accounts, 'zzz', ['code', 'name'])).toEqual([]);
  });

  it('skips undefined keys and non-string values without throwing', () => {
    const items = [{ code: '1000', name: undefined }, { code: '2000' }];
    expect(filterArray(items, '1000', ['code', 'name', 'missing'])).toEqual([items[0]]);
  });

  it('tolerates an empty key list and a non-array input', () => {
    expect(filterArray(accounts, 'Encaisse', [])).toEqual([]);
    expect(filterArray(undefined as unknown as typeof accounts, 'x', ['code'])).toEqual([]);
  });
});
