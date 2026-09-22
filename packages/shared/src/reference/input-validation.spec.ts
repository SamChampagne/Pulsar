import { describe, expect, it } from 'vitest';
import { isValidPhone, isValidPostalCode } from './input-validation';
describe('business contact validation', () => {
  it.each(['+1 (514) 555-0123', '514-555-0123 poste 42', '+33 1 42 68 53 00', '5550123', ''])(
    'accepts phone %s',
    (value) => expect(isValidPhone(value)).toBe(true),
  );
  it.each(['bonjour', '123', '123456789012345678', '514-AAA-0123', '+1 514 555 0123 xhello'])(
    'rejects phone %s',
    (value) => expect(isValidPhone(value)).toBe(false),
  );
  it.each([
    ['H1A 1A1', 'CA'],
    ['k1a0b1', 'CA'],
    ['90210', 'US'],
    ['12345-6789', 'US'],
    ['SW1A 1AA', 'GB'],
    ['', 'CA'],
  ])('accepts postal %s/%s', (value, country) =>
    expect(isValidPostalCode(value, country)).toBe(true),
  );
  it.each([
    ['123456789012345678', 'CA'],
    ['12345', 'CA'],
    ['H1A 1A1', 'US'],
    ['D1A 1A1', 'CA'],
    ['123456', 'US'],
  ])('rejects postal %s/%s', (value, country) =>
    expect(isValidPostalCode(value, country)).toBe(false),
  );
});
