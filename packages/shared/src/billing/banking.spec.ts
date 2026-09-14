import { describe, it, expect } from 'vitest';
import { parseBankCsv, maskAccountNumber, bankBalance, BankTxnStatus } from './banking';
import { bankMatchError, canTransitionBankTxn } from './banking';

describe('conservative bank matching', () => {
  const base = {
    transactionAmount: -128.65,
    paymentAmount: 128.65,
    allocatedAmount: 128.65,
    bankCurrency: 'CAD',
    paymentCurrency: 'CAD',
    bankAccountCode: '1010',
    paymentAccountCode: '1010',
    paymentType: 'PAY',
  };
  it('accepts exact pay and receive movements', () => {
    expect(bankMatchError(base)).toBeNull();
    expect(
      bankMatchError({ ...base, paymentType: 'RECEIVE', transactionAmount: 128.65 }),
    ).toBeNull();
  });
  it.each([
    { transactionAmount: 128.65 },
    { transactionAmount: -128.64 },
    { paymentCurrency: 'USD' },
    { paymentAccountCode: '1000' },
    { allocatedAmount: 100 },
    { paymentAmount: 0 },
    { transactionAmount: NaN },
    { paymentType: 'UNKNOWN' },
  ])('rejects incompatible inputs %j', (change) => {
    expect(bankMatchError({ ...base, ...change })).toEqual(expect.any(String));
  });
  it('only allows the two guarded status transitions', () => {
    expect(canTransitionBankTxn(BankTxnStatus.UNRECONCILED, BankTxnStatus.RECONCILED)).toBe(true);
    expect(canTransitionBankTxn(BankTxnStatus.RECONCILED, BankTxnStatus.UNRECONCILED)).toBe(true);
    expect(canTransitionBankTxn(BankTxnStatus.RECONCILED, BankTxnStatus.RECONCILED)).toBe(false);
  });
});

describe('parseBankCsv', () => {
  it('parses header + comma rows', () => {
    const r = parseBankCsv(
      'date,description,amount,reference\n2026-01-05,Depot,100.50,REF1\n2026-01-06,Frais,-12.00,',
    );
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
  it('shows last 4', () => {
    expect(maskAccountNumber('123456789')).toBe('•••• 6789');
  });
  it('handles null/short', () => {
    expect(maskAccountNumber(null)).toBe('—');
    expect(maskAccountNumber('12')).toBe('•••• 12');
  });
});

describe('bankBalance', () => {
  it('sums signed amounts round2', () => {
    expect(bankBalance([100.5, -12, 50])).toBe(138.5);
  });
});

describe('BankTxnStatus', () => {
  it('values', () => {
    expect(BankTxnStatus.UNRECONCILED).toBe('UNRECONCILED');
    expect(BankTxnStatus.RECONCILED).toBe('RECONCILED');
  });
});
