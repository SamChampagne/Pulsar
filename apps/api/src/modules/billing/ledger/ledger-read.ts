import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import {
  CURRENCIES,
  calendarDate,
  ledgerCents,
  ledgerAmount,
  type ExactAccountRow,
} from '@pulsar/shared';

export function checkedCurrency(currency?: string): string {
  if (!CURRENCIES.some((c) => c.code === currency))
    throw new BadRequestException(
      'Choisissez explicitement une devise prise en charge. Aucun total interdevises.',
    );
  return currency!;
}
/** Supported historical sources use a separate, current qualification. Never rewrite GL. */
export function effectiveCurrencyWhere(currency: string | null): Prisma.JournalEntryWhereInput {
  return currency === null
    ? {
        currency: null,
        OR: [
          { currencyQualification: { is: null } },
          { currencyQualification: { is: { state: 'WITHDRAWN' } } },
        ],
      }
    : {
        OR: [
          { currency },
          { currency: null, currencyQualification: { is: { state: 'QUALIFIED', currency } } },
        ],
      };
}
export function ledgerDateRange(from?: Date, to?: Date) {
  for (const d of [from, to])
    if (
      d &&
      (!Number.isFinite(d.getTime()) || d.getUTCFullYear() < 1900 || d.getUTCFullYear() > 2199)
    )
      throw new BadRequestException('Date comptable invalide.');
  const start = from ? new Date(from.toISOString().slice(0, 10) + 'T00:00:00.000Z') : undefined;
  const end = to ? new Date(to.toISOString().slice(0, 10) + 'T23:59:59.999Z') : undefined;
  if (start && end && start > end)
    throw new BadRequestException('La date de début dépasse la date de fin.');
  return { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) };
}
export function parseLedgerDate(value?: string) {
  if (value === undefined || value === '') return undefined;
  try {
    calendarDate(value);
  } catch {
    throw new BadRequestException('Une date civile réelle AAAA-MM-JJ est requise.');
  }
  return new Date(value + 'T00:00:00.000Z');
}
/** Same snapshot for selected sums and excluded/unknown coverage. SQL numeric, no Number money. */
export async function readLedger(
  tx: Prisma.TransactionClient,
  tenantId: string,
  currency: string,
  from?: Date,
  to?: Date,
  accountCodes?: string[],
) {
  checkedCurrency(currency);
  const date = ledgerDateRange(from, to);
  const effective = Prisma.sql`COALESCE(e.currency, CASE WHEN q.state='QUALIFIED' THEN q.currency END)`;
  const join = Prisma.sql`LEFT JOIN ledger_currency_qualifications q ON q."tenantId"=e."tenantId" AND q."entryId"=e.id`;
  const scope = [Prisma.sql`e."tenantId"=${tenantId}`];
  if (date.gte) scope.push(Prisma.sql`e.date>=${date.gte}`);
  if (date.lte) scope.push(Prisma.sql`e.date<=${date.lte}`);
  const coverageScope = [...scope];
  if (accountCodes)
    coverageScope.push(
      accountCodes.length
        ? Prisma.sql`EXISTS(SELECT 1 FROM journal_lines x JOIN chart_of_accounts ca ON ca.id=x."accountId" AND ca."tenantId"=x."tenantId" WHERE x."tenantId"=e."tenantId" AND x."journalEntryId"=e.id AND ca.code IN (${Prisma.join(accountCodes)}))`
        : Prisma.sql`FALSE`,
    );
  const entries = await tx.$queryRaw<
    { currency: string | null; count: number; qualified: number }[]
  >(Prisma.sql`
    SELECT ${effective} AS currency, COUNT(*)::int AS count,
      COUNT(*) FILTER(WHERE e.currency IS NULL AND q.state='QUALIFIED')::int AS qualified
    FROM journal_entries e ${join} WHERE ${Prisma.join(coverageScope, ' AND ')} GROUP BY ${effective} ORDER BY currency`);
  const conditions = [...scope, Prisma.sql`${effective}=${currency}`];
  if (accountCodes)
    conditions.push(
      accountCodes.length
        ? Prisma.sql`a.code IN (${Prisma.join(accountCodes)})`
        : Prisma.sql`FALSE`,
    );
  const rows = await tx.$queryRaw<ExactAccountRow[]>(Prisma.sql`
    SELECT a.id AS "accountId",a.code,a.name,a.type::text AS type,SUM(l.debit)::text AS debit,SUM(l.credit)::text AS credit
    FROM journal_entries e ${join} JOIN journal_lines l ON l."journalEntryId"=e.id AND l."tenantId"=e."tenantId"
    JOIN chart_of_accounts a ON a.id=l."accountId" AND a."tenantId"=l."tenantId"
    WHERE ${Prisma.join(conditions, ' AND ')} GROUP BY a.id,a.code,a.name,a.type ORDER BY a.code,a.id`);
  let normalized: ExactAccountRow[];
  try {
    normalized = rows.map((r) => ({
      ...r,
      debit: ledgerAmount(ledgerCents(r.debit)),
      credit: ledgerAmount(ledgerCents(r.credit)),
    }));
  } catch {
    throw new ConflictException(
      'Le journal contient des fractions de cent non qualifiées. Revue comptable requise, aucun arrondi implicite.',
    );
  }
  return {
    rows: normalized,
    currency,
    coverage: {
      unknownEntries: entries.find((e) => e.currency === null)?.count ?? 0,
      selectedEntries: entries.find((e) => e.currency === currency)?.count ?? 0,
      qualifiedHistoricalEntries: entries.find((e) => e.currency === currency)?.qualified ?? 0,
      otherCurrencies: entries
        .filter((e) => e.currency !== null && e.currency !== currency)
        .map((e) => ({ currency: e.currency, count: e.count })),
    },
    basis: 'TRANSACTION_CURRENCY' as const,
  };
}
