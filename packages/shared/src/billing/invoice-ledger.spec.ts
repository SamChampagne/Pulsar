import { describe, expect, it } from 'vitest';
import {
  frozenInvoiceTaxes,
  reconcileInvoiceLedger,
  reconcileCustomerCreditLedger,
  reconcileAcceptedCarrierAmounts,
} from './invoice-ledger';
const source = {
  customer: true,
  net: '100',
  tax: '15',
  total: '115',
  taxes: [
    { accountCode: '2100', amount: '5' },
    { accountCode: '2110', amount: '10' },
  ],
  lines: [
    { accountCode: '1100', accountType: 'ASSET', debit: '115', credit: '0' },
    { accountCode: '4000', accountType: 'REVENUE', debit: '0', credit: '100' },
    { accountCode: '2100', accountType: 'LIABILITY', debit: '0', credit: '5' },
    { accountCode: '2110', accountType: 'LIABILITY', debit: '0', credit: '10' },
  ],
};
describe('Invoice ledger recovery', () => {
  const accepted = {
    total: '120',
    tax: '15',
    invoicedTotal: '120',
    varianceTotal: '20',
    varianceGross: '20',
    lines: [{ amount: '100', invoicedAmount: '120', variance: '20' }],
  };
  it('keeps accepted payable and frozen tax distinct from original expected lines', () => {
    expect(reconcileAcceptedCarrierAmounts(accepted)).toEqual({
      expectedLinesAmount: '100.00',
      receivedLinesAmount: '120.00',
      expectedTotalWithFrozenTax: '115.00',
      payableAdjustment: '5.00',
      reconciliationVariance: '20.00',
      reconciliationGrossVariance: '20.00',
      net: '105.00',
    });
    expect(
      reconcileAcceptedCarrierAmounts({
        ...accepted,
        total: '90',
        invoicedTotal: '90',
        varianceTotal: '-10',
        varianceGross: '10',
        lines: [{ amount: '100', invoicedAmount: '90', variance: '-10' }],
      }),
    ).toMatchObject({ payableAdjustment: '-25.00', net: '75.00' });
  });
  it('validates gross variances without netting compensating line differences', () => {
    const mixed = {
      total: '110',
      tax: '0',
      invoicedTotal: '110',
      varianceTotal: '10',
      varianceGross: '30',
      lines: [
        { amount: '50', invoicedAmount: '70', variance: '20' },
        { amount: '50', invoicedAmount: '40', variance: '-10' },
      ],
    };
    expect(reconcileAcceptedCarrierAmounts(mixed).reconciliationGrossVariance).toBe('30.00');
    expect(() => reconcileAcceptedCarrierAmounts({ ...mixed, varianceGross: '10' })).toThrow();
  });
  it('rejects missing, negative, fractional or inconsistent captured reconciliation amounts', () => {
    for (const change of [
      { total: '115' },
      { tax: '120' },
      { tax: '-1' },
      { invoicedTotal: '119' },
      { varianceTotal: '19' },
      { varianceGross: '-20' },
      { lines: [] },
      { lines: [{ amount: '-1', invoicedAmount: '120', variance: '121' }] },
      { lines: [{ amount: '100', invoicedAmount: '-120', variance: '-220' }] },
      { lines: [{ amount: '100', invoicedAmount: '120', variance: '19' }] },
      { lines: [{ amount: '100.001', invoicedAmount: '120', variance: '19.999' }] },
    ])
      expect(() => reconcileAcceptedCarrierAmounts({ ...accepted, ...change })).toThrow();
  });
  it('preserves exact high amounts and one-cent adjustments', () => {
    expect(
      reconcileAcceptedCarrierAmounts({
        total: '9999999999.99',
        tax: '0',
        invoicedTotal: '9999999999.99',
        varianceTotal: '0.01',
        varianceGross: '0.01',
        lines: [{ amount: '9999999999.98', invoicedAmount: '9999999999.99', variance: '0.01' }],
      }).payableAdjustment,
    ).toBe('0.01');
  });
  it('matches frozen totals and posted accounts independently of current settings', () => {
    expect(reconcileInvoiceLedger(source)).toMatchObject({
      net: '100.00',
      tax: '15.00',
      total: '115.00',
      controlAccount: '1100',
      netAccount: '4000',
    });
    expect(
      reconcileInvoiceLedger({
        ...source,
        customer: false,
        lines: source.lines.map((l, i) => ({
          ...l,
          debit: l.credit,
          credit: l.debit,
          accountType: i === 0 ? 'LIABILITY' : i === 1 ? 'EXPENSE' : 'ASSET',
        })),
      }).total,
    ).toBe('115.00');
  });
  it('accepts many taxes, aggregates captured amounts exactly and rejects fractional cents', () => {
    expect(
      frozenInvoiceTaxes(
        Array.from({ length: 15 }, (_, i) => ({ accountCode: 'T' + (i % 5), amount: '0.01' })),
        '0.15',
      ),
    ).toHaveLength(5);
    for (const amount of ['0.001', '-1', 'NaN'])
      expect(() => frozenInvoiceTaxes([{ accountCode: 'T', amount }], amount)).toThrow();
    expect(() => frozenInvoiceTaxes(null, '0')).toThrow();
    expect(() => frozenInvoiceTaxes([], '1')).toThrow();
  });
  it('rejects wrong shape, totals, account types and ambiguous tax roles', () => {
    for (const change of [
      { net: '0' },
      { total: '114.99' },
      { tax: '14' },
      { lines: source.lines.map((l, i) => (i === 0 ? { ...l, accountType: 'EXPENSE' } : l)) },
      { lines: source.lines.map((l, i) => (i === 2 ? { ...l, accountType: 'ASSET' } : l)) },
      { taxes: [{ accountCode: '4000', amount: '15' }] },
      {
        lines: [
          ...source.lines,
          { accountCode: 'T', accountType: 'LIABILITY', debit: '1', credit: '0' },
          { accountCode: 'T', accountType: 'LIABILITY', debit: '0', credit: '1' },
        ],
      },
    ])
      expect(() => reconcileInvoiceLedger({ ...source, ...change })).toThrow();
  });
  it('matches partial credits on original accounts without rounding or conversion', () => {
    const input = {
      original: reconcileInvoiceLedger(source),
      net: '20',
      tax: '3',
      total: '23',
      taxes: [
        { accountCode: '2100', amount: '1' },
        { accountCode: '2110', amount: '2' },
      ],
      lines: source.lines.map((l, i) => ({
        ...l,
        debit: i === 0 ? '0' : ['0', '20', '1', '2'][i],
        credit: i === 0 ? '23' : '0',
      })),
    };
    expect(reconcileCustomerCreditLedger(input).total).toBe('23.00');
    expect(() =>
      reconcileCustomerCreditLedger({
        ...input,
        lines: input.lines.map((l, i) => (i === 0 ? { ...l, accountCode: '1099' } : l)),
      }),
    ).toThrow();
    expect(() =>
      reconcileCustomerCreditLedger({ ...input, original: { ...input.original, net: '19' } }),
    ).toThrow();
  });
});
