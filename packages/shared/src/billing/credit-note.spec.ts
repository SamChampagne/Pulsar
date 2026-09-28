import { describe, expect, it } from 'vitest';
import {
  calculateCustomerCredit,
  CustomerCreditStatus as S,
  canTransitionCustomerCredit,
  invoiceBalance,
} from './credit-note';
const fixture = {
  totalAmount: '114.98',
  taxAmount: '14.98',
  taxes: [
    { description: 'GST', rate: 5, accountCode: '2300', amount: 5 },
    { description: 'QST', rate: 9.975, accountCode: '2310', amount: 9.98 },
  ],
  lines: [{ id: 'a', amount: 100, quantity: 3, creditedQuantity: 0 }],
};
describe('Frozen customer credits', () => {
  it('only leaves DRAFT and never reverses an issued note', () => {
    expect(canTransitionCustomerCredit(S.DRAFT, S.ISSUED)).toBe(true);
    expect(canTransitionCustomerCredit(S.DRAFT, S.CANCELLED)).toBe(true);
    for (const from of [S.ISSUED, S.CANCELLED])
      for (const to of Object.values(S)) expect(canTransitionCustomerCredit(from, to)).toBe(false);
  });
  it('keeps paid cash distinct from credits and exposes overpayments', () => {
    expect(invoiceBalance(100, 25, 35)).toEqual({ outstanding: 40, customerCredit: 0 });
    expect(invoiceBalance(100, 100, 35)).toEqual({ outstanding: 0, customerCredit: 35 });
    expect(invoiceBalance('0.3', '0.1', '0.2').outstanding).toBe(0);
  });
  it('reverses the exact frozen net and every tax through cumulative thirds', () => {
    const notes = [0, 1, 2].map((before) =>
      calculateCustomerCredit({
        ...fixture,
        lines: [{ ...fixture.lines[0], creditedQuantity: before }],
        requested: [{ invoiceLineId: 'a', quantity: 1 }],
      }),
    );
    expect(notes.map((n) => n.netAmount)).toEqual([33.33, 33.34, 33.33]);
    expect(Math.round(notes.reduce((s, n) => s + n.totalAmount, 0) * 100)).toBe(11498);
    expect(
      Math.round(notes.reduce((s, n) => s + Number(n.lines[0].taxes[1].amount), 0) * 100),
    ).toBe(998);
  });
  it('uses stable largest remainders independently of source ordering', () => {
    const lines = [
      { id: 'b', amount: 1, quantity: 1, creditedQuantity: 0 },
      { id: 'a', amount: 1, quantity: 1, creditedQuantity: 0 },
    ];
    const input = {
      totalAmount: 2.01,
      taxAmount: 0.01,
      taxes: [{ description: 'Tax', rate: 0.5, accountCode: '2300', amount: 0.01 }],
      lines,
      requested: [{ invoiceLineId: 'a', quantity: 1 }],
    };
    expect(calculateCustomerCredit(input).taxAmount).toBe(0.01);
    expect(calculateCustomerCredit({ ...input, lines: [...lines].reverse() })).toEqual(
      calculateCustomerCredit(input),
    );
    expect(
      calculateCustomerCredit({ ...input, requested: [{ invoiceLineId: 'b', quantity: 1 }] })
        .taxAmount,
    ).toBe(0);
  });
  it('accepts decimal quantities and fractional amount-only lines', () => {
    expect(
      calculateCustomerCredit({
        totalAmount: 10,
        taxAmount: 0,
        taxes: [],
        lines: [{ id: 'a', amount: 10, quantity: 2.5, creditedQuantity: 0.375 }],
        requested: [{ invoiceLineId: 'a', quantity: 2.125 }],
      }).totalAmount,
    ).toBe(8.5);
    expect(
      calculateCustomerCredit({
        totalAmount: 10,
        taxAmount: 0,
        taxes: [],
        lines: [{ id: 'a', amount: 10, quantity: null, creditedQuantity: 0 }],
        requested: [{ invoiceLineId: 'a', quantity: 0.25 }],
      }).totalAmount,
    ).toBe(2.5);
  });
  it('rejects unknown, duplicate, excessive, negative and over-precision quantities', () => {
    for (const requested of [
      [{ invoiceLineId: 'other', quantity: 1 }],
      [
        { invoiceLineId: 'a', quantity: 1 },
        { invoiceLineId: 'a', quantity: 1 },
      ],
      ...[0, -1, 4, Infinity, 0.00001].map((quantity) => [{ invoiceLineId: 'a', quantity }]),
    ])
      expect(() => calculateCustomerCredit({ ...fixture, requested })).toThrow();
    expect(() =>
      calculateCustomerCredit({
        ...fixture,
        lines: [{ ...fixture.lines[0], creditedQuantity: 2.9 }],
        requested: [{ invoiceLineId: 'a', quantity: 0.2 }],
      }),
    ).toThrow();
  });
  it('refuses incoherent snapshots and zero-value notes', () => {
    const requested = [{ invoiceLineId: 'a', quantity: 1 }];
    expect(() => calculateCustomerCredit({ ...fixture, totalAmount: 115, requested })).toThrow(
      'incohérent',
    );
    expect(() => calculateCustomerCredit({ ...fixture, taxes: [], requested })).toThrow(
      'incohérent',
    );
    expect(() =>
      calculateCustomerCredit({
        ...fixture,
        requested: [{ invoiceLineId: 'a', quantity: 0.0001 }],
      }),
    ).toThrow('nul');
  });
});
