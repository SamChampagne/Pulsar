import { describe, it, expect } from 'vitest';
import { invoiceHref, postedPaymentTotals, type Payment } from './payments';

const payment = (patch: Partial<Payment> = {}) =>
  ({
    status: 'SUBMITTED',
    type: 'RECEIVE',
    currency: 'CAD',
    totalAmount: '900',
    allocations: [{ amount: '40.25' }],
    ...patch,
  }) as Payment;

describe('payment display helpers', () => {
  it('keeps currencies and payment directions separate and uses only posted allocations', () => {
    expect(
      postedPaymentTotals([
        payment(),
        payment({ type: 'PAY' }),
        payment({ currency: 'USD' }),
        payment({ status: 'DRAFT' }),
        payment({ status: 'CANCELLED' }),
      ]),
    ).toEqual([
      { currency: 'CAD', received: 40.25, paid: 40.25 },
      { currency: 'USD', received: 40.25, paid: 0 },
    ]);
  });
  it('does not display a fabricated financial total for an empty view', () => {
    expect(postedPaymentTotals([])).toEqual([]);
  });
  it('links the correct invoice family with an encoded identifier', () => {
    expect(invoiceHref('CUSTOMER_INVOICE', 'a&b')).toBe('/invoices?statement=a%26b');
    expect(invoiceHref('CARRIER_INVOICE', 'a&b')).toBe('/invoices?invoice=a%26b');
  });
});
