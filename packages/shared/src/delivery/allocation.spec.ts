import { describe, expect, it } from 'vitest';
import {
  deliveryAllocationDecimal,
  deliveryAllocationMilli,
  deriveDeliveryAllocationQuantities,
} from './allocation';

describe('delivery allocation exact quantities', () => {
  it('keeps maximum quantities exact without floating-point arithmetic', () => {
    expect(deliveryAllocationMilli('999999999999.999')).toBe(999999999999999n);
    expect(deliveryAllocationDecimal(999999999999999n)).toBe('999999999999.999');
    expect(deliveryAllocationDecimal(1000n)).toBe('1');
    expect(deliveryAllocationDecimal(1n)).toBe('0.001');
  });
  it.each(['-1', '1e3', '1.0001', '1000000000000', '01', 'NaN'])('rejects invalid %s', (value) => {
    expect(() => deliveryAllocationMilli(value)).toThrow();
  });
  it('separates allocated, delivered, returned and remaining', () => {
    expect(
      deriveDeliveryAllocationQuantities('10.005', 'ea', [
        { quantity: '3.001', unit: 'ea', packageStatus: 'DELIVERED', released: false },
        { quantity: '2', unit: 'ea', packageStatus: 'RETURNED', released: false },
        { quantity: '1.004', unit: 'ea', packageStatus: 'PREPARED', released: false },
        { quantity: '100', unit: 'kg', packageStatus: 'CANCELLED', released: true },
      ]),
    ).toEqual({
      allocated: '6.005',
      delivered: '3.001',
      returned: '2',
      remainingToAllocate: '4',
      remainingToDeliver: '7.004',
    });
  });
  it('never silently releases a cancelled or returned source attribution', () => {
    expect(
      deriveDeliveryAllocationQuantities('2', 'ea', [
        { quantity: '2', unit: 'ea', packageStatus: 'RETURNED', released: false },
      ]),
    ).toMatchObject({ remainingToAllocate: '0', remainingToDeliver: '2', returned: '2' });
    expect(
      deriveDeliveryAllocationQuantities('2', 'ea', [
        { quantity: '2', unit: 'ea', packageStatus: 'CANCELLED', released: false },
      ]).allocated,
    ).toBe('2');
  });
  it('refuses cross-unit sums, unknown states and over-allocation', () => {
    expect(() =>
      deriveDeliveryAllocationQuantities('1', 'ea', [
        { quantity: '1', unit: 'EA', packageStatus: 'LOADED', released: false },
      ]),
    ).toThrow('Unités');
    expect(() =>
      deriveDeliveryAllocationQuantities('1', 'ea', [
        { quantity: '1.001', unit: 'ea', packageStatus: 'LOADED', released: false },
      ]),
    ).toThrow('dépasse');
    expect(() =>
      deriveDeliveryAllocationQuantities('1', 'ea', [
        { quantity: '1', unit: 'ea', packageStatus: 'FUTURE', released: false },
      ]),
    ).toThrow('inconnu');
  });
});
