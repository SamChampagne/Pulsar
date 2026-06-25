import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AuditAction, DEFAULT_CHART, isBalanced } from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { paginated, paginationArgs } from '../../../common/pagination';
import { ListQueryDto } from '../../../common/dto/list-query.dto';

export interface PostInput {
  date?: Date;
  memo?: string;
  sourceType?: string;
  sourceId?: string;
  sourceKind?: string;
  lines: {
    accountCode: string;
    debit?: number;
    credit?: number;
    memo?: string;
  }[];
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

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
   * Post a balanced journal entry.
   * - Idempotent on (tenantId, sourceType, sourceId, sourceKind): returns { posted: false } if already exists.
   * - Throws BadRequest on unknown account code or unbalanced lines.
   * - Audits on success (règle 6).
   */
  async post(
    tenantId: string,
    input: PostInput,
    userId?: string,
  ): Promise<{ posted: boolean; journalEntryId?: string }> {
    // Step 1: ensure chart exists
    await this.ensureChart(tenantId);

    // Step 2: resolve accountCode → accountId (tenant-scoped)
    const codes = [...new Set(input.lines.map((l) => l.accountCode))];
    const accounts = await this.prisma.chartOfAccount.findMany({
      where: { tenantId, code: { in: codes }, active: true },
      select: { id: true, code: true },
    });
    const codeToId = new Map(accounts.map((a) => [a.code, a.id]));

    for (const code of codes) {
      if (!codeToId.has(code)) {
        throw new BadRequestException(`Unknown account code: ${code}`);
      }
    }

    // Step 3: validate balance using isBalanced from @pulsar/shared (Decimal→Number at boundary)
    const balanceLines = input.lines.map((l) => ({
      debit: Number(l.debit ?? 0),
      credit: Number(l.credit ?? 0),
    }));
    if (!isBalanced(balanceLines)) {
      throw new BadRequestException('Journal entry is not balanced');
    }

    // Step 4: idempotence check on (tenantId, sourceType, sourceId, sourceKind)
    if (input.sourceType && input.sourceId) {
      const existing = await this.prisma.journalEntry.findFirst({
        where: {
          tenantId,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          sourceKind: input.sourceKind ?? null,
        },
        select: { id: true },
      });
      if (existing) return { posted: false, journalEntryId: existing.id };
    }

    // Step 5: persist entry + lines in a transaction
    // Wrap in try/catch: a concurrent call may have raced past the findFirst check
    // and already inserted the same (tenantId, sourceType, sourceId, sourceKind)
    // tuple. The DB unique constraint (@@unique) will surface this as P2002; we
    // treat it as a successful idempotent no-op rather than an error.
    let entry: { id: string };
    try {
      entry = await (this.prisma.$transaction as (fn: (tx: any) => Promise<any>) => Promise<any>)(
        async (tx: any) => {
          return tx.journalEntry.create({
            data: {
              tenantId,
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
        },
      );
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // Concurrent post of the same source tuple — already posted.
        return { posted: false };
      }
      throw err;
    }

    // Step 6: audit (règle 6)
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.CREATE,
      entityType: 'journal-entry',
      entityId: entry.id,
      after: {
        date: input.date ?? new Date(),
        memo: input.memo,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        sourceKind: input.sourceKind,
        lineCount: input.lines.length,
      },
    });

    return { posted: true, journalEntryId: entry.id };
  }

  /**
   * Read-time trial balance. Groups JournalLines by account, sums debit/credit.
   * Optional asOf: only includes journal entries on or before that date.
   */
  async trialBalance(
    tenantId: string,
    asOf?: Date,
  ): Promise<{
    rows: {
      accountId: string;
      code: string;
      name: string;
      type: string;
      debit: number;
      credit: number;
      balance: number;
    }[];
    totalDebit: number;
    totalCredit: number;
  }> {
    // Normalize asOf to end of that calendar day so entries posted at any time
    // during that day are included (e.g. 2024-06-01T23:59:59.999Z).
    let asOfEnd: Date | undefined;
    if (asOf) {
      asOfEnd = new Date(asOf);
      asOfEnd.setHours(23, 59, 59, 999);
    }

    // Fetch all lines (tenant-scoped) with entry date filter if asOf provided
    const lines = await this.prisma.journalLine.findMany({
      where: {
        tenantId,
        ...(asOfEnd
          ? {
              entry: {
                date: { lte: asOfEnd },
              },
            }
          : {}),
      },
      select: {
        accountId: true,
        debit: true,
        credit: true,
        account: { select: { code: true, name: true, type: true } },
      },
    });

    // Group by accountId, summing debit/credit (Decimal→Number at boundary)
    const map = new Map<
      string,
      { accountId: string; code: string; name: string; type: string; debit: number; credit: number }
    >();

    for (const line of lines) {
      const existing = map.get(line.accountId);
      if (existing) {
        existing.debit = round2(existing.debit + Number(line.debit));
        existing.credit = round2(existing.credit + Number(line.credit));
      } else {
        map.set(line.accountId, {
          accountId: line.accountId,
          code: line.account.code,
          name: line.account.name,
          type: line.account.type,
          debit: round2(Number(line.debit)),
          credit: round2(Number(line.credit)),
        });
      }
    }

    const rows = [...map.values()]
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((r) => ({ ...r, balance: round2(r.debit - r.credit) }));

    const totalDebit = round2(rows.reduce((s, r) => s + r.debit, 0));
    const totalCredit = round2(rows.reduce((s, r) => s + r.credit, 0));

    return { rows, totalDebit, totalCredit };
  }

  /** Returns the tenant's full chart of accounts, ordered by code. */
  async listAccounts(tenantId: string) {
    return this.prisma.chartOfAccount.findMany({
      where: { tenantId },
      orderBy: { code: 'asc' },
    });
  }

  /** Returns a paginated list of journal entries with their lines (+ account), ordered date desc. */
  async listJournal(
    tenantId: string,
    query: ListQueryDto & { accountId?: string; dateFrom?: string; dateTo?: string },
  ) {
    const { page, pageSize, skip, take } = paginationArgs(query);

    const where: any = { tenantId };
    if (query.accountId) {
      where.lines = { some: { accountId: query.accountId } };
    }
    if (query.dateFrom || query.dateTo) {
      where.date = {
        ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
        ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
      };
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.journalEntry.findMany({
        where,
        orderBy: { date: 'desc' },
        skip,
        take,
        include: {
          lines: {
            include: {
              account: { select: { id: true, code: true, name: true, type: true } },
            },
          },
        },
      }),
      this.prisma.journalEntry.count({ where }),
    ]);

    return paginated(items, total, page, pageSize);
  }
}
