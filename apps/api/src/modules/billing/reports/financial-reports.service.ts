import { Injectable } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import {
  exactProfitAndLoss,
  exactBalanceSheet,
  exactCashFlow,
  exactCurrentAging,
  ledgerCents,
  ledgerAmount,
} from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { ModuleSettingsService } from '../../../core/module-registry/module-settings.service';
import { checkedCurrency, ledgerDateRange, readLedger } from '../ledger/ledger-read';

@Injectable()
export class FinancialReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moduleSettings: ModuleSettingsService,
  ) {}
  private read(
    tenantId: string,
    currency: string | undefined,
    from: Date | undefined,
    to: Date | undefined,
    kind: 'pl' | 'bs' | 'cf',
    cashCodes: string[] = [],
  ) {
    checkedCurrency(currency);
    return this.prisma.$transaction(
      async (tx) => {
        const result = await readLedger(tx, tenantId, currency!, from, to);
        const report =
          kind === 'pl'
            ? exactProfitAndLoss(result.rows)
            : kind === 'bs'
              ? exactBalanceSheet(result.rows)
              : exactCashFlow(result.rows, cashCodes);
        return {
          ...report,
          currency: result.currency,
          coverage: result.coverage,
          basis: result.basis,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  profitAndLoss(tenantId: string, from?: Date, to?: Date, currency?: string) {
    return this.read(tenantId, currency, from, to, 'pl');
  }
  balanceSheet(tenantId: string, asOf?: Date, currency?: string) {
    return this.read(tenantId, currency, undefined, asOf, 'bs');
  }
  async cashFlow(tenantId: string, from?: Date, to?: Date, currency?: string) {
    const settings = await this.moduleSettings.resolve(tenantId, 'billing');
    return this.read(
      tenantId,
      currency,
      from,
      to,
      'cf',
      [settings.cashAccountCode, settings.bankAccountCode].filter(
        (v): v is string => typeof v === 'string',
      ),
    );
  }
  /** Current outstanding, classified by approval/creation age, NOT historical due-date aging. */
  async arAging(tenantId: string, asOf?: Date, currency?: string) {
    checkedCurrency(currency);
    const ref = asOf ?? new Date();
    ledgerDateRange(undefined, ref);
    const rows = await this.prisma.customerInvoice.findMany({
      where: { tenantId, currency, status: { not: 'DRAFT' } },
      select: {
        customerId: true,
        customer: { select: { name: true } },
        approvedAt: true,
        createdAt: true,
        totalAmount: true,
        amountPaid: true,
        creditedAmount: true,
      },
    });
    const items = rows.map((r) => ({
      partyId: r.customerId,
      partyName: r.customer.name,
      date: r.approvedAt ?? r.createdAt,
      outstanding: ledgerAmount(
        ledgerCents(r.totalAmount.toString()) -
          ledgerCents(r.amountPaid.toString()) -
          ledgerCents(r.creditedAmount.toString()),
      ),
    }));
    return {
      ...exactCurrentAging(items, ref),
      currency,
      basis: 'CURRENT_BALANCE_BY_APPROVAL_AGE',
      referenceDate: ref.toISOString().slice(0, 10),
    };
  }
  async apAging(tenantId: string, asOf?: Date, currency?: string) {
    checkedCurrency(currency);
    const ref = asOf ?? new Date();
    ledgerDateRange(undefined, ref);
    const rows = await this.prisma.invoice.findMany({
      where: { tenantId, currency, status: { not: 'DRAFT' } },
      select: {
        carrierId: true,
        carrier: { select: { name: true } },
        approvedAt: true,
        createdAt: true,
        totalAmount: true,
        amountPaid: true,
      },
    });
    const items = rows.map((r) => ({
      partyId: r.carrierId,
      partyName: r.carrier.name,
      date: r.approvedAt ?? r.createdAt,
      outstanding: ledgerAmount(
        ledgerCents(r.totalAmount.toString()) - ledgerCents(r.amountPaid.toString()),
      ),
    }));
    return {
      ...exactCurrentAging(items, ref),
      currency,
      basis: 'CURRENT_CARRIER_BALANCE_BY_APPROVAL_AGE',
      referenceDate: ref.toISOString().slice(0, 10),
    };
  }
}
