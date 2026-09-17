import { describe, expect, it } from 'vitest';

import invoice210 from './__fixtures__/210-invoice.edi?raw';
import { parseX12 } from './x12';
import { read210 } from './x12-210';

function invoiceFrom(text: string) {
  const { ok, errors, document } = parseX12(text);
  expect(errors).toEqual([]);
  expect(ok).toBe(true);
  return read210(document!.transactions[0]);
}

describe('read210', () => {
  const invoice = invoiceFrom(invoice210);

  it('reads the B3 header with implied-decimal money', () => {
    expect(invoice.invoiceNumber).toBe('INV-77410');
    expect(invoice.shipmentId).toBe('SHP-2026-0042');
    expect(invoice.carrierScac).toBe('CRXY');
    expect(invoice.methodOfPayment).toBe('PP');
    expect(invoice.date).toBe('2026-09-25');
    expect(invoice.deliveryDate).toBe('2026-09-22');
    expect(invoice.netAmount).toBe(2685.5);
    expect(invoice.currency).toBe('CAD');
  });

  it('reads the references and parties', () => {
    expect(invoice.references).toEqual([
      { qualifier: 'BM', value: 'BOL-99120', description: undefined },
      { qualifier: 'CN', value: 'SHP-2026-0042', description: undefined },
    ]);
    expect(invoice.parties).toHaveLength(2);
    expect(invoice.parties[0]).toMatchObject({
      entityCode: 'BT',
      name: 'ACME MANUFACTURING',
      address1: '1200 RUE NOTRE-DAME OUEST',
      city: 'MONTREAL',
      state: 'QC',
      postalCode: 'H3C1K3',
      country: 'CA',
    });
    expect(invoice.parties[1]).toMatchObject({ entityCode: 'CN', city: 'TORONTO' });
  });

  it('reads one line per LX loop with its charge code and quantities', () => {
    expect(invoice.lines).toHaveLength(3);
    expect(invoice.lines[0]).toMatchObject({
      lineNumber: 1,
      description: 'TRANSPORT PRINCIPAL',
      amount: 2250,
      rateQualifier: 'FR',
      qty: 16,
      unit: 'PLT',
      weight: 24000,
      weightUnit: 'L',
    });
    expect(invoice.lines[1]).toMatchObject({
      lineNumber: 2,
      description: 'SURCHARGE CARBURANT',
      amount: 337.5,
      chargeCode: '405',
    });
    expect(invoice.lines[2]).toMatchObject({
      lineNumber: 3,
      description: 'ARRET SUPPLEMENTAIRE',
      amount: 98,
      chargeCode: '400',
    });
  });

  it('totals from L3 and agrees with the sum of the lines and B3-07', () => {
    expect(invoice.total).toBe(2685.5);
    expect(invoice.weight).toBe(24000);
    expect(invoice.weightUnit).toBe('L');
    const summed = invoice.lines.reduce((sum, line) => sum + line.amount, 0);
    expect(Math.round(summed * 100) / 100).toBe(invoice.total);
    expect(invoice.netAmount).toBe(invoice.total);
  });

  it('falls back to B3-07 when the 210 carries no L3 total', () => {
    const withoutL3 = invoice210.replace(/L3\*[^~]*~\n/, '');
    const { document } = parseX12(withoutL3);
    const fallback = read210(document!.transactions[0]);
    expect(fallback.total).toBe(2685.5);
    expect(fallback.lines).toHaveLength(3);
  });

  it('falls back to the sum of the lines when B3-07 is empty too', () => {
    const bare = invoice210.replace(/L3\*[^~]*~\n/, '').replace('*20260925*268550*', '*20260925**');
    const { document } = parseX12(bare);
    const fallback = read210(document!.transactions[0]);
    expect(fallback.netAmount).toBeUndefined();
    expect(fallback.total).toBe(2685.5);
  });

  it('never throws on a 210 with no B3', () => {
    const invoiceless = read210({
      st: { tag: 'ST', elements: ['210', '0001'] },
      segments: [{ tag: 'ZZZ', elements: [] }],
      transactionSetId: '210',
      controlNumber: '0001',
      functionalId: 'IM',
    });
    expect(invoiceless.invoiceNumber).toBe('');
    expect(invoiceless.total).toBe(0);
    expect(invoiceless.lines).toEqual([]);
  });
});
