import { Injectable } from '@nestjs/common';
import {
  AccountBalanceInput,
  ReportLine,
  buildProfitAndLoss,
  buildBalanceSheet,
  naturalBalance,
  buildAging,
  AgingItemInput,
} from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { ModuleSettingsService } from '../../../core/module-registry/module-settings.service';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

@Injectable()
export class FinancialReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moduleSettings: ModuleSettingsService,
  ) {}

  /**
   * Aggregates JournalLines by account (tenant-scoped, optional date range).
   * Mirrors LedgerService.trialBalance: Decimal→Number, round2, end-of-day normalization.
   */
  private async aggregateByAccount(
    tenantId: string,
    range: { from?: Date; to?: Date },
  ): Promise<AccountBalanceInput[]> {
    let toEnd: Date | undefined;
    if (range.to) {
      toEnd = new Date(range.to);
      toEnd.setHours(23, 59, 59, 999);
    }

    const lines = await this.prisma.journalLine.findMany({
      where: {
        tenantId,
        ...(range.from || toEnd
          ? {
              entry: {
                date: {
                  ...(range.from ? { gte: range.from } : {}),
                  ...(toEnd ? { lte: toEnd } : {}),
                },
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

    const map = new Map<
      string,
      AccountBalanceInput & { accountId: string }
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

    return [...map.values()].sort((a, b) => a.code.localeCompare(b.code));
  }

  async profitAndLoss(tenantId: string, from?: Date, to?: Date) {
    const rows = await this.aggregateByAccount(tenantId, { from, to });
    return buildProfitAndLoss(rows);
  }

  async balanceSheet(tenantId: string, asOf?: Date) {
    const rows = await this.aggregateByAccount(tenantId, { to: asOf });
    const { netIncome } = buildProfitAndLoss(rows);
    return buildBalanceSheet(rows, netIncome);
  }

  async cashFlow(
    tenantId: string,
    from?: Date,
    to?: Date,
  ): Promise<{ accounts: ReportLine[]; netChange: number }> {
    const settings = await this.moduleSettings.resolve(tenantId, 'billing');
    const cashCode = settings['cashAccountCode'] as string | undefined;
    const bankCode = settings['bankAccountCode'] as string | undefined;

    const rows = await this.aggregateByAccount(tenantId, { from, to });

    const cashCodes = new Set<string>();
    if (cashCode) cashCodes.add(cashCode);
    if (bankCode) cashCodes.add(bankCode);

    const accounts: ReportLine[] =
      cashCodes.size === 0
        ? []
        : rows
            .filter((r) => cashCodes.has(r.code))
            .map((r) => ({ code: r.code, name: r.name, amount: naturalBalance(r) }));

    const netChange = round2(accounts.reduce((s, a) => s + a.amount, 0));

    return { accounts, netChange };
  }

  async arAging(tenantId: string, asOf?: Date) {
    const ref = asOf ?? new Date();
    const invoices = await this.prisma.customerInvoice.findMany({
      where: { tenantId, status: { not: 'DRAFT' } },
      include: { customer: { select: { name: true } } },
    });

    const items: AgingItemInput[] = invoices
      .map((inv) => ({
        partyId: inv.customerId,
        partyName: inv.customer.name,
        reference: inv.invoiceNumber,
        date: inv.approvedAt ?? inv.createdAt,
        outstanding: round2(Number(inv.totalAmount) - Number(inv.amountPaid)),
      }))
      .filter((it) => it.outstanding > 0);

    return buildAging(items, ref);
  }

  async apAging(tenantId: string, asOf?: Date) {
    const ref = asOf ?? new Date();
    const invoices = await this.prisma.invoice.findMany({
      where: { tenantId, status: { not: 'DRAFT' } },
      include: { carrier: { select: { name: true } } },
    });

    const items: AgingItemInput[] = invoices
      .map((inv) => ({
        partyId: inv.carrierId,
        partyName: inv.carrier.name,
        reference: inv.invoiceNumber,
        date: inv.approvedAt ?? inv.createdAt,
        outstanding: round2(Number(inv.totalAmount) - Number(inv.amountPaid)),
      }))
      .filter((it) => it.outstanding > 0);

    return buildAging(items, ref);
  }
}
