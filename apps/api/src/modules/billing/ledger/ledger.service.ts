import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, DEFAULT_CHART, exactTrialBalance, validateLedgerLines } from '@pulsar/shared';
import { createHash } from 'node:crypto';
import {
  checkedCurrency,
  effectiveCurrencyWhere,
  ledgerDateRange,
  parseLedgerDate,
  readLedger,
} from './ledger-read';
import { Prisma } from '@pulsar/database';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { ModuleSettingsService } from '../../../core/module-registry/module-settings.service';
import { paginated, paginationArgs } from '../../../common/pagination';
import { ListQueryDto } from '../../../common/dto/list-query.dto';

export interface PostInput {
  currency: string | null;
  operationKey?: string;
  date?: Date;
  memo?: string;
  sourceType?: string;
  sourceId?: string;
  sourceKind?: string;
  lines: {
    accountCode: string;
    debit?: number | string;
    credit?: number | string;
    memo?: string;
  }[];
}

@Injectable()
export class LedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly moduleSettings: ModuleSettingsService,
  ) {}

  /**
   * Manual journal-entry posting from the ledger UI. Gated by the billing
   * `ledgerManualEntries` setting — ONLY this manual path is gated, never the
   * best-effort auto-post from billing transitions (règle 41).
   */
  async postManual(
    tenantId: string,
    input: PostInput,
    userId?: string,
  ): Promise<{ posted: boolean; journalEntryId?: string }> {
    const s = await this.moduleSettings.resolve(tenantId, 'billing');
    if (s.ledgerManualEntries === false) {
      throw new ForbiddenException('Manual ledger entries are disabled for this tenant');
    }
    checkedCurrency(input.currency ?? undefined);
    if (!input.operationKey) throw new BadRequestException('Clé de reprise obligatoire.');
    return this.post(
      tenantId,
      { ...input, sourceType: 'manual', sourceId: input.operationKey, sourceKind: 'posted' },
      userId,
    );
  }

  /**
   * Seed the tenant's chart of accounts from DEFAULT_CHART if they have none.
   * Idempotent — checks count first, only seeds when count === 0.
   */
  async ensureChart(tenantId: string): Promise<void> {
    const count = await this.prisma.chartOfAccount.count({ where: { tenantId } });
    if (count > 0) return;
    await this.prisma.chartOfAccount.createMany({
      data: DEFAULT_CHART.map((row) => ({
        tenantId,
        code: row.code,
        name: row.name,
        type: row.type,
      })),
      skipDuplicates: true,
    });
  }

  /**
   * Post a balanced journal entry inside a caller-supplied transaction client.
   * This is the canonical implementation; `post()` delegates here by wrapping
   * in its own `$transaction`.
   *
   * Rules preserved:
   * - Account-code resolution goes through `tx` (tenant-scoped).
   * - Exact cents validation via validateLedgerLines.
   * - Idempotence on (tenantId, sourceType, sourceId, sourceKind) via `tx` read +
   *   tenant advisory lock before lookup (including nullable sourceKind).
   * - Audit via AuditLogsService in the SAME transaction.
   */
  async postTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    input: PostInput,
    userId?: string,
  ): Promise<{ posted: boolean; journalEntryId?: string }> {
    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      'pulsar:ledger:' + tenantId,
    );
    try {
      input = { ...input, lines: validateLedgerLines(input.lines) };
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    if (input.currency !== null) checkedCurrency(input.currency);
    else if (!(input.sourceType === 'payment' && input.sourceKind === 'reversal'))
      throw new BadRequestException('Devise comptable obligatoire.');
    if (input.date) ledgerDateRange(input.date, input.date);
    const fingerprint =
      input.sourceType === 'manual'
        ? createHash('sha256')
            .update(
              JSON.stringify([
                tenantId,
                userId,
                input.date?.toISOString(),
                input.currency,
                input.memo ?? '',
                input.lines,
              ]),
            )
            .digest('hex')
        : null;
    if (input.currency === null && input.sourceType === 'payment') {
      const original = await tx.journalEntry.findFirst({
        where: { tenantId, sourceType: 'payment', sourceId: input.sourceId, sourceKind: null },
        select: { currency: true },
      });
      if (!original || original.currency !== null)
        throw new ConflictException('Devise de la contrepassation historique incohérente.');
    }
    // Step 3: idempotence check on (tenantId, sourceType, sourceId, sourceKind)
    if (input.sourceType && input.sourceId) {
      const existing = await tx.journalEntry.findFirst({
        where: {
          tenantId,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          sourceKind: input.sourceKind ?? null,
        },
        select: { id: true, currency: true, fingerprint: true },
      });
      if (existing) {
        if (
          (fingerprint && fingerprint !== existing.fingerprint) ||
          (existing.currency !== null && existing.currency !== input.currency)
        )
          throw new ConflictException('Clé ou source déjà utilisée pour une écriture différente.');
        return { posted: false, journalEntryId: existing.id };
      }
    }

    // Step 1: resolve accountCode → accountId (tenant-scoped) via caller's tx
    const codes = [...new Set(input.lines.map((l) => l.accountCode))];
    const accounts = await tx.chartOfAccount.findMany({
      where: { tenantId, code: { in: codes }, active: true },
      select: { id: true, code: true },
    });
    const codeToId = new Map(
      (accounts as { id: string; code: string }[]).map((a) => [a.code, a.id]),
    );

    for (const code of codes) {
      if (!codeToId.has(code)) {
        throw new BadRequestException(`Unknown account code: ${code}`);
      }
    }

    // Step 4: persist entry + lines inside caller's transaction.
    const entry = await tx.journalEntry.create({
      data: {
        tenantId,
        currency: input.currency,
        fingerprint,
        date: input.date ?? new Date(),
        memo: input.memo,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        sourceKind: input.sourceKind,
        createdById: userId,
        lines: {
          create: input.lines.map((l) => ({
            tenantId,
            accountId: codeToId.get(l.accountCode)!,
            debit: l.debit ?? 0,
            credit: l.credit ?? 0,
            memo: l.memo,
          })),
        },
      },
      select: { id: true },
    });
    // Journal + audit commit or roll back together.
    await this.audit.log(
      {
        tenantId,
        userId,
        action: AuditAction.CREATE,
        entityType: 'journal-entry',
        entityId: entry.id,
        after: {
          date: input.date ?? new Date(),
          memo: input.memo,
          currency: input.currency,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          sourceKind: input.sourceKind,
          lineCount: input.lines.length,
        },
      },
      tx,
    );

    return { posted: true, journalEntryId: entry.id };
  }

  /**
   * Post a balanced journal entry.
   * - Idempotent on (tenantId, sourceType, sourceId, sourceKind): returns { posted: false } if already exists.
   * - Throws BadRequest on unknown account code or unbalanced lines.
   * - Audits on success (règle 6).
   *
   * Delegates to `postTx` inside its own transaction. Use `postTx` directly when
   * you need the GL write to commit/rollback with a caller-supplied transaction
   * (e.g. PaymentsService.submit — rule 41).
   */
  async post(
    tenantId: string,
    input: PostInput,
    userId?: string,
  ): Promise<{ posted: boolean; journalEntryId?: string }> {
    // Ensure chart exists before entering the transaction (avoids nested tx issues).
    await this.ensureChart(tenantId);
    return (this.prisma.$transaction as (fn: (tx: any) => Promise<any>) => Promise<any>)((tx) =>
      this.postTx(tx, tenantId, input, userId),
    );
  }

  /** Exact per-currency view. Unknown history is counted, never converted. */
  async trialBalance(tenantId: string, asOf?: Date, currency?: string) {
    checkedCurrency(currency);
    return this.prisma.$transaction(
      async (tx) => {
        const result = await readLedger(tx, tenantId, currency!, undefined, asOf);
        return { ...result, ...exactTrialBalance(result.rows) };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  /** Returns the tenant's full chart of accounts, ordered by code. */
  async listAccounts(tenantId: string) {
    return this.prisma.chartOfAccount.findMany({
      where: { tenantId },
      orderBy: { code: 'asc' },
    });
  }

  async manualRequest(tenantId: string, userId: string, key: string) {
    const r = await this.prisma.journalEntry.findFirst({
      where: {
        tenantId,
        createdById: userId,
        sourceType: 'manual',
        sourceId: key,
        sourceKind: 'posted',
      },
      select: { id: true, currency: true, date: true },
    });
    if (!r) throw new NotFoundException('Aucune écriture pour cette demande.');
    return r;
  }

  /** Returns a paginated list of journal entries with their lines (+ account), ordered date desc. */
  async listJournal(
    tenantId: string,
    query: ListQueryDto & {
      accountId?: string;
      dateFrom?: string;
      dateTo?: string;
      sourceType?: string;
      sourceId?: string;
      currency?: string;
      unqualified?: boolean;
    },
  ) {
    const { page, pageSize, skip, take } = paginationArgs(query);

    if (query.currency && query.unqualified)
      throw new BadRequestException('Choisir devise ou écritures sans devise.');
    const where: Prisma.JournalEntryWhereInput = {
      tenantId,
      date: ledgerDateRange(parseLedgerDate(query.dateFrom), parseLedgerDate(query.dateTo)),
    };
    if (query.currency)
      Object.assign(where, effectiveCurrencyWhere(checkedCurrency(query.currency)));
    if (query.unqualified) Object.assign(where, effectiveCurrencyWhere(null));
    if (query.sourceType) where.sourceType = query.sourceType;
    if (query.sourceId) where.sourceId = query.sourceId;
    if (query.accountId) {
      where.lines = { some: { tenantId, accountId: query.accountId } };
    }
    const [items, total] = await this.prisma.$transaction(
      [
        this.prisma.journalEntry.findMany({
          where,
          orderBy: [{ date: 'desc' }, { id: 'desc' }],
          skip,
          take,
          include: {
            currencyQualification: { select: { state: true, currency: true, version: true } },
            lines: {
              where: { tenantId, account: { tenantId } },
              include: {
                account: { select: { id: true, code: true, name: true, type: true } },
              },
            },
          },
        }),
        this.prisma.journalEntry.count({ where }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

    return paginated(
      items.map(({ fingerprint: _private, ...entry }) => ({
        ...entry,
        originalCurrency: entry.currency,
        currency:
          entry.currency ??
          (entry.currencyQualification?.state === 'QUALIFIED'
            ? entry.currencyQualification.currency
            : null),
      })),
      total,
      page,
      pageSize,
    );
  }
}
