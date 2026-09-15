import { describe, it, expect } from 'vitest';
import { inspectBankCsv, bankRowIdentity, BANK_CSV_MAX_CHARS, BANK_CSV_MAX_ROWS } from './bank-csv';

describe('bank CSV inspection', () => {
  it('reads BOM, reordered French columns, decimal comma and escaped multiline quotes', () => {
    const r = inspectBankCsv(
      '\uFEFFmontant;référence;description;date\r\n-135,08;FJ-218;"Transport; du ""Fjord""\nQuébec";2026-09-14',
    );
    expect(r.issues).toEqual([]);
    expect(r.rows).toEqual([
      {
        line: 2,
        amount: -135.08,
        reference: 'FJ-218',
        description: 'Transport; du "Fjord" Québec',
        date: '2026-09-14',
      },
    ]);
  });
  it('retains physical line numbers through blank and quoted lines', () => {
    const r = inspectBankCsv(
      '\n date;description;amount\n\n2026-09-14;"A\nB";12.01\n2026-02-30;Invalide;10',
    );
    expect(r.rows[0].line).toBe(4);
    expect(r.issues[0].line).toBe(6);
  });
  it('accepts headerless legacy CSV and descriptions that look like column names', () => {
    expect(inspectBankCsv('2026-09-14,amount,12.05').rows[0]).toMatchObject({
      description: 'amount',
      amount: 12.05,
    });
  });
  it('accepts a leap day and a quoted comma', () => {
    expect(
      inspectBankCsv('date,description,amount\n2024-02-29,"Transport, Québec",-12.05').issues,
    ).toEqual([]);
  });
  it.each([
    '2026-02-29',
    '2026-04-31',
    '2026-13-01',
    '2026-00-01',
    '14/09/2026',
    '09/14/2026',
    '1899-01-01',
    '2026-9-14',
  ])('rejects invalid/ambiguous date %s', (date) => {
    const r = inspectBankCsv(`date,description,amount\n${date},Transport,-12.05`);
    expect(r.rows).toEqual([]);
    expect(r.errors[0]).toContain('Date invalide');
  });
  it.each([
    'NaN',
    'Infinity',
    '1e3',
    '0',
    '-0.00',
    '12.345',
    '1 234.00',
    'CAD 15',
    '10000000000',
    '1,234.50',
  ])('rejects ambiguous or out of range amount %s', (amount) => {
    expect(
      inspectBankCsv(`date;description;amount\n2026-09-14;Transport;${amount}`).issues,
    ).toHaveLength(1);
  });
  it.each([
    'date,description,amount,amount',
    'date,description,balance',
    'date,description,amount,currency',
    'date,description,amount,__proto__',
    'date,description,amount,constructor',
  ])('rejects invalid columns %s', (header) => {
    expect(inspectBankCsv(`${header}\n2026-09-14,Transport,12,CAD`).rows).toEqual([]);
  });
  it.each(['2026-09-14,"Non fermé,12', '2026-09-14,"Fermé"texte,12', '2026-09-14,Guill"emet,12'])(
    'rejects malformed quoting %s',
    (row) => {
      const r = inspectBankCsv(`date,description,amount\n${row}`);
      expect(r.rows).toEqual([]);
      expect(r.issues).toHaveLength(1);
    },
  );
  it('rejects missing, extra and overlong fields without silently shifting columns', () => {
    for (const row of [
      ',,',
      '2026-09-14,Transport',
      '2026-09-14,Transport,12,REF,extra',
      `2026-09-14,${'x'.repeat(201)},12`,
      '2026-09-14,,12',
      '2026-09-14,Null\u0000,12',
    ])
      expect(inspectBankCsv(`date,description,amount\n${row}`).issues).toHaveLength(1);
  });
  it('enforces whole-file bounds and reports empty content', () => {
    for (const text of [
      '',
      'date,description,amount',
      'x'.repeat(BANK_CSV_MAX_CHARS + 1),
      'date,description,amount\n' + '2026-09-14,A,1\n'.repeat(BANK_CSV_MAX_ROWS + 1),
    ])
      expect(inspectBankCsv(text).issues.length).toBeGreaterThan(0);
  });
  it('retains valid rows for preview alongside invalid rows, never calls them a valid batch', () => {
    const r = inspectBankCsv('date,description,amount\n2026-09-14,Bon,12\n2026-02-30,Erreur,12');
    expect(r.rows).toHaveLength(1);
    expect(r.issues).toHaveLength(1);
  });
  it('uses normalized fields and cents, but preserves meaningful differences', () => {
    const row = {
      date: '2026-09-14',
      description: 'Transport Québec',
      amount: -135.08,
      reference: 'FJ-218',
    };
    expect(bankRowIdentity(row)).toBe(
      bankRowIdentity({ ...row, description: ' Transport  Québec ' }),
    );
    for (const change of [
      { date: '2026-09-15' },
      { amount: 135.08 },
      { reference: 'FJ-219' },
      { description: 'Autre transport' },
    ])
      expect(bankRowIdentity(row)).not.toBe(bankRowIdentity({ ...row, ...change }));
  });
});
