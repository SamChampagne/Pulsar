import { describe, expect, it } from 'vitest';
import {
  canTransitionDeliveryPackage,
  DeliveryPackageStatus as Status,
  deriveDeliveryPackageCounts,
  normalizeDeliveryPackageLabel,
  normalizeDeliveryPackageQuantity,
  validateDeliveryPackageContents,
} from './packages';

const line = { reference: 'COMP-1', description: 'Composant', quantity: '12.500', unit: 'piece' };

describe('delivery package quantities', () => {
  it.each([
    ['1', '1'],
    ['1.000', '1'],
    ['0.001', '0.001'],
    ['12.500', '12.5'],
    [' 2.010 ', '2.01'],
    ['999999999999.999', '999999999999.999'],
  ])('normalizes %s exactly', (input, expected) => {
    expect(normalizeDeliveryPackageQuantity(input)).toBe(expected);
  });
  it.each([
    '0',
    '0.000',
    '-1',
    '+1',
    '01',
    '.5',
    '1.',
    '1,5',
    '1e3',
    '1_000',
    '1.0001',
    '1000000000000',
    '9999999999999',
    'NaN',
    'Infinity',
    '',
    '  ',
    '1\n2',
    '1 000',
    null,
    undefined,
    1,
    NaN,
    Infinity,
    {},
    [],
    true,
  ])('rejects invalid or inexact quantity %j', (input) => {
    expect(() => normalizeDeliveryPackageQuantity(input)).toThrow();
  });
});

describe('delivery package content validation', () => {
  it('normalizes a fresh closed snapshot without changing its input', () => {
    const input = [
      { reference: ' COMP-1 ', description: ' Composant ', quantity: '12.500', unit: ' piece ' },
    ];
    const result = validateDeliveryPackageContents(input);
    expect(result).toEqual([{ ...line, quantity: '12.5' }]);
    expect(input[0].quantity).toBe('12.500');
    expect(result[0]).not.toBe(input[0]);
  });
  it('accepts up to 50 lines without merging references or units', () => {
    const input = Array.from({ length: 50 }, (_, index) => ({
      ...line,
      unit: index % 2 ? 'kg' : 'piece',
    }));
    expect(validateDeliveryPackageContents(input)).toHaveLength(50);
    expect(validateDeliveryPackageContents(input)[1].unit).toBe('kg');
  });
  it.each([null, {}, '', [], Array.from({ length: 51 }, () => line)])(
    'rejects invalid list %j',
    (input) => {
      expect(() => validateDeliveryPackageContents(input)).toThrow();
    },
  );
  it.each([null, [], 'text', 3, new Date(), Object.assign(Object.create({ hidden: true }), line)])(
    'rejects a non-record line %j',
    (input) => {
      expect(() => validateDeliveryPackageContents([input])).toThrow();
    },
  );
  it.each([
    { ...line, other: 'ignored?' },
    { reference: line.reference, description: line.description, quantity: line.quantity },
    { ...line, reference: '' },
    { ...line, reference: 'a'.repeat(81) },
    { ...line, description: ' ' },
    { ...line, description: 'a'.repeat(201) },
    { ...line, unit: 42 },
    { ...line, unit: '' },
    { ...line, unit: 'a'.repeat(21) },
    { ...line, reference: 'a\u0000b' },
    { ...line, description: 'a\nb' },
    { ...line, quantity: 12.5 },
    { ...line, [Symbol('extra')]: true },
  ])('rejects incomplete, unknown or malformed fields %j', (input) => {
    expect(() => validateDeliveryPackageContents([input])).toThrow();
  });
  it('accepts the maximum field lengths and a null-prototype JSON-shaped record', () => {
    const input = Object.assign(Object.create(null), {
      reference: 'r'.repeat(80),
      description: 'd'.repeat(200),
      quantity: '1',
      unit: 'u'.repeat(20),
    });
    expect(validateDeliveryPackageContents([input])).toEqual([input]);
  });
  it('normalizes an optional label without accepting arbitrary data', () => {
    expect(normalizeDeliveryPackageLabel('  Carton fragile  ')).toBe('Carton fragile');
    expect(normalizeDeliveryPackageLabel('')).toBe('');
    expect(normalizeDeliveryPackageLabel('a'.repeat(120))).toHaveLength(120);
    expect(() => normalizeDeliveryPackageLabel('a'.repeat(121))).toThrow();
    expect(() => normalizeDeliveryPackageLabel(null)).toThrow();
    expect(() => normalizeDeliveryPackageLabel('a\u007fb')).toThrow();
  });
  it('rejects a sparse array rather than persisting null content lines', () => {
    expect(() => validateDeliveryPackageContents(new Array(1))).toThrow();
  });
});

describe('delivery package workflow', () => {
  const allowed = new Set([
    'PREPARED:LOADED',
    'PREPARED:CANCELLED',
    'LOADED:PREPARED',
    'LOADED:DELIVERED',
    'LOADED:RETURNED',
    'DELIVERED:RETURNED',
  ]);
  for (const from of Object.values(Status)) {
    for (const to of Object.values(Status)) {
      it(`${from} → ${to}`, () => {
        expect(canTransitionDeliveryPackage(from, to)).toBe(allowed.has(`${from}:${to}`));
      });
    }
  }
  it('fails closed for unknown source or target statuses', () => {
    expect(canTransitionDeliveryPackage('UNKNOWN' as Status, Status.LOADED)).toBe(false);
    expect(canTransitionDeliveryPackage('constructor' as Status, Status.LOADED)).toBe(false);
    expect(canTransitionDeliveryPackage('__proto__' as Status, Status.LOADED)).toBe(false);
    expect(canTransitionDeliveryPackage(Status.PREPARED, 'UNKNOWN' as Status)).toBe(false);
  });
});

describe('physical package counts', () => {
  it('does not infer a delivery or sum product quantities', () => {
    const packages = [
      { status: Status.PREPARED, contents: [line] },
      { status: Status.LOADED, contents: [{ ...line, quantity: '999999999999.999', unit: 'kg' }] },
      { status: Status.DELIVERED, contents: [line] },
      { status: Status.DELIVERED, contents: [line] },
      { status: Status.CANCELLED, contents: [line] },
    ];
    expect(deriveDeliveryPackageCounts(packages)).toEqual({
      total: 5,
      active: 4,
      prepared: 1,
      loaded: 1,
      delivered: 2,
      cancelled: 1,
      returned: 0,
    });
  });
  it('keeps empty counts empty', () => {
    expect(deriveDeliveryPackageCounts([])).toEqual({
      total: 0,
      active: 0,
      prepared: 0,
      loaded: 0,
      delivered: 0,
      cancelled: 0,
      returned: 0,
    });
  });
  it('rejects unknown statuses rather than counting them as completed', () => {
    expect(() => deriveDeliveryPackageCounts([{ status: 'UNKNOWN' as Status }])).toThrow();
  });
});
