/** Deliberately bounded bank CSV contract; no locale/date guessing or implicit rounding. */
export const BANK_CSV_MAX_CHARS = 30_000;
export const BANK_CSV_MAX_ROWS = 500;
export interface CsvBankRow {
  date: string;
  description: string;
  amount: number;
  reference?: string;
}
export interface BankCsvIssue {
  line: number;
  message: string;
}
export interface ParsedBankRow extends CsvBankRow {
  line: number;
}
export interface BankCsvInspection {
  rows: ParsedBankRow[];
  issues: BankCsvIssue[];
  errors: string[];
}
export interface BankCsvPreview {
  bankAccountId: string;
  currency: string;
  previewHash: string;
  canImport: boolean;
  rows: (ParsedBankRow & { status: 'NEW' | 'DUPLICATE_FILE' | 'DUPLICATE_EXISTING' })[];
  issues: BankCsvIssue[];
  errors: string[];
  totals: {
    newCount: number;
    duplicateCount: number;
    invalidCount: number;
    credits: number;
    debits: number;
  };
}
export interface BankCsvImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

const clean = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ');
/** Tuple encoding prevents delimiter collisions; date is a canonical UTC calendar date. */
export function bankRowIdentity(row: CsvBankRow): string {
  return JSON.stringify([
    row.date,
    clean(row.description),
    Math.round(row.amount * 100),
    clean(row.reference ?? ''),
  ]);
}

function delimiter(text: string): ',' | ';' {
  let quoted = false,
    commas = 0,
    semicolons = 0,
    content = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      content = true;
      if (quoted && text[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (!quoted) {
      if (c === '\n' || c === '\r') {
        if (content) break;
        else continue;
      }
      if (c.trim()) content = true;
      if (c === ',') commas++;
      if (c === ';') semicolons++;
    }
  }
  return semicolons > commas ? ';' : ',';
}

function scan(text: string): {
  records: { line: number; fields: string[] }[];
  issue?: BankCsvIssue;
} {
  const sep = delimiter(text),
    records: { line: number; fields: string[] }[] = [];
  let fields: string[] = [],
    field = '',
    quoted = false,
    closed = false,
    line = 1,
    recordLine = 1;
  for (let i = 0; i <= text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === undefined)
        return { records: [], issue: { line: recordLine, message: 'Guillemet non fermé.' } };
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else {
        field += c;
        if (c === '\n') line++;
      }
      continue;
    }
    if (c === sep || c === '\n' || c === '\r' || c === undefined) {
      fields.push(field.trim());
      field = '';
      closed = false;
      if (c !== sep) {
        if (fields.length > 1 || fields.some((f) => f !== ''))
          records.push({ line: recordLine, fields });
        fields = [];
        if (c === '\r' && text[i + 1] === '\n') i++;
        line++;
        recordLine = line;
      }
    } else if (c === '"' && !field.trim() && !closed) {
      field = '';
      quoted = true;
    } else if ((closed && c !== ' ' && c !== '\t') || c === '"') {
      return {
        records: [],
        issue: { line, message: 'Guillemets mal placés ou texte après un champ fermé.' },
      };
    } else field += c;
    if (records.length > BANK_CSV_MAX_ROWS + 1)
      return {
        records: [],
        issue: { line, message: `Maximum ${BANK_CSV_MAX_ROWS} mouvements par import.` },
      };
  }
  return { records };
}

export function inspectBankCsv(raw: string): BankCsvInspection {
  const rows: ParsedBankRow[] = [],
    issues: BankCsvIssue[] = [];
  const result = () => ({
    rows,
    issues,
    errors: issues.map((i) => `Ligne ${i.line} : ${i.message}`),
  });
  if (raw.length > BANK_CSV_MAX_CHARS) {
    issues.push({ line: 1, message: `Maximum ${BANK_CSV_MAX_CHARS} caractères.` });
    return result();
  }
  const { records, issue } = scan(raw.replace(/^\uFEFF/, ''));
  if (issue) {
    issues.push(issue);
    return result();
  }
  if (!records.length) {
    issues.push({ line: 1, message: 'Le CSV ne contient aucun mouvement.' });
    return result();
  }
  const aliases: Record<string, string> = {
    date: 'date',
    description: 'description',
    amount: 'amount',
    montant: 'amount',
    reference: 'reference',
    référence: 'reference',
  };
  const first = records[0].fields.map((f) => f.toLowerCase());
  const hasHeader =
    !/^\d{4}-\d{2}-\d{2}$/.test(first[0]) && first.some((f) => Object.hasOwn(aliases, f));
  let columns = ['date', 'description', 'amount', 'reference'];
  if (hasHeader) {
    columns = first.map((f) => (Object.hasOwn(aliases, f) ? aliases[f] : ''));
    if (
      columns.some((c) => !c) ||
      new Set(columns).size !== columns.length ||
      !['date', 'description', 'amount'].every((c) => columns.includes(c))
    ) {
      issues.push({
        line: records[0].line,
        message:
          'Colonnes attendues : date, description, amount (ou montant), reference facultative. Aucune colonne inconnue ou répétée.',
      });
      return result();
    }
  }
  const data = records.slice(hasHeader ? 1 : 0);
  if (!data.length || data.length > BANK_CSV_MAX_ROWS) {
    issues.push({
      line: 1,
      message: `Le CSV doit contenir entre 1 et ${BANK_CSV_MAX_ROWS} mouvements.`,
    });
    return result();
  }
  for (const record of data) {
    const fail = (message: string) => issues.push({ line: record.line, message });
    if (
      hasHeader ? record.fields.length !== columns.length : ![3, 4].includes(record.fields.length)
    ) {
      fail('Nombre de colonnes incorrect.');
      continue;
    }
    const field = (key: string) => record.fields[columns.indexOf(key)] ?? '';
    const date = field('date'),
      description = clean(field('description')),
      reference = clean(field('reference'));
    const amountText = field('amount');
    const parsedDate = new Date(`${date}T00:00:00.000Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      Number(date.slice(0, 4)) < 1900 ||
      !Number.isFinite(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== date
    ) {
      fail('Date invalide : utilisez une date réelle au format AAAA-MM-JJ (année ≥ 1900).');
      continue;
    }
    if (
      !description ||
      description.length > 200 ||
      reference.length > 200 ||
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(description + reference)
    ) {
      fail(
        'Description requise; description et référence limitées à 200 caractères sans caractères de contrôle.',
      );
      continue;
    }
    if (!/^[+-]?\d{1,10}(?:[.,]\d{1,2})?$/.test(amountText)) {
      fail('Montant invalide : nombre signé, sans milliers ni symbole, avec au plus 2 décimales.');
      continue;
    }
    const amount = Number(amountText.replace(',', '.'));
    if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 9_999_999_999.99) {
      fail('Le montant doit être non nul et compris entre -9999999999.99 et 9999999999.99.');
      continue;
    }
    rows.push({ line: record.line, date, description, amount, reference: reference || undefined });
  }
  return result();
}

/** Compatibility facade: existing consumers keep rows without presentation line numbers. */
export function parseBankCsv(text: string): { rows: CsvBankRow[]; errors: string[] } {
  const parsed = inspectBankCsv(text);
  return { rows: parsed.rows.map(({ line: _line, ...row }) => row), errors: parsed.errors };
}
