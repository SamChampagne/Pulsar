import { describe, it, expect } from 'vitest';
import { parseBankCsv, maskAccountNumber, bankBalance, BankTxnStatus } from './banking';

describe('parseBankCsv', () => {
  it('parses header + comma rows', () => {
    const r = parseBankCsv('date,description,amount,reference\n2026-01-05,Depot,100.50,REF1\n2026-01-06,Frais,-12.00,');
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      { date: '2026-01-05', description: 'Depot', amount: 100.5, reference: 'REF1' },
      { date: '2026-01-06', description: 'Frais', amount: -12, reference: undefined },
    ]);
  });
  it('tolerates semicolons and blank lines', () => {
    const r = parseBankCsv('date;description;amount\n\n2026-02-01;Vir;50\n');
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].amount).toBe(50);
  });
  it('reports invalid amount as an error and skips the row', () => {
    const r = parseBankCsv('date,description,amount\n2026-01-01,Bad,abc');
    expect(r.rows).toHaveLength(0);
    expect(r.errors.length).toBe(1);
  });
});

describe('maskAccountNumber', () => {
  it('shows last 4', () => { expect(maskAccountNumber('123456789')).toBe('•••• 6789'); });
  it('handles null/short', () => { expect(maskAccountNumber(null)).toBe('—'); expect(maskAccountNumber('12')).toBe('•••• 12'); });
});

describe('bankBalance', () => {
  it('sums signed amounts round2', () => { expect(bankBalance([100.5, -12, 50])).toBe(138.5); });
});

describe('BankTxnStatus', () => {
  it('values', () => { expect(BankTxnStatus.UNRECONCILED).toBe('UNRECONCILED'); expect(BankTxnStatus.RECONCILED).toBe('RECONCILED'); });
});
