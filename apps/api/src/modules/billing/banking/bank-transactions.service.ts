import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, BankTxnStatus, parseBankCsv } from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { ModesOfPaymentService } from '../modes-of-payment.service';
import { CreateBankTransactionDto, ImportBankCsvDto } from './dto/bank-transaction.dto';

@Injectable()
export class BankTransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly modes: ModesOfPaymentService,
  ) {}

  private async assertAccountOwned(tenantId: string, bankAccountId: string) {
    const account = await this.prisma.bankAccount.findFirst({
      where: { id: bankAccountId, tenantId },
      select: { id: true, glAccountCode: true },
    });
    if (!account) throw new NotFoundException(`BankAccount ${bankAccountId} not found`);
    return account;
  }

  list(tenantId: string, bankAccountId?: string, status?: BankTxnStatus) {
    return this.prisma.bankTransaction.findMany({
      where: {
        tenantId,
        ...(bankAccountId ? { bankAccountId } : {}),
        ...(status ? { status } : {}),
      },
      orderBy: { date: 'desc' },
    });
  }

  async create(tenantId: string, dto: CreateBankTransactionDto) {
    await this.assertAccountOwned(tenantId, dto.bankAccountId);
    return this.prisma.bankTransaction.create({
      data: {
        tenantId,
        bankAccountId: dto.bankAccountId,
        date: new Date(dto.date),
        description: dto.description,
        amount: new Prisma.Decimal(dto.amount),
        reference: dto.reference,
        status: BankTxnStatus.UNRECONCILED,
      },
    });
  }

  async import(tenantId: string, dto: ImportBankCsvDto) {
    await this.assertAccountOwned(tenantId, dto.bankAccountId);
    const { rows, errors } = parseBankCsv(dto.csv);
    if (rows.length > 0) {
      await this.prisma.bankTransaction.createMany({
        data: rows.map((r) => ({
          tenantId,
          bankAccountId: dto.bankAccountId,
          date: new Date(r.date),
          amount: new Prisma.Decimal(r.amount),
          description: r.description,
          reference: r.reference ?? null,
          status: BankTxnStatus.UNRECONCILED,
        })),
      });
    }
    return { imported: rows.length, errors };
  }

  async reconciliation(tenantId: string, bankAccountId: string) {
    const account = await this.assertAccountOwned(tenantId, bankAccountId);

    const unreconciledTransactions = await this.prisma.bankTransaction.findMany({
      where: { tenantId, bankAccountId, status: BankTxnStatus.UNRECONCILED },
      orderBy: { date: 'desc' },
    });

    const allSubmitted = await this.prisma.payment.findMany({
      where: { tenantId, status: 'SUBMITTED', reconciledAt: null },
      include: { modeOfPayment: true },
    });

    const candidatePayments = allSubmitted.filter(
      (p) => p.modeOfPayment?.accountCode === account.glAccountCode,
    );

    return { unreconciledTransactions, candidatePayments };
  }

  async match(tenantId: string, userId: string, txnId: string, paymentId: string) {
    const txn = await this.prisma.bankTransaction.findFirst({
      where: { id: txnId, tenantId },
    });
    if (!txn) throw new NotFoundException(`BankTransaction ${txnId} not found`);
    if (txn.status !== BankTxnStatus.UNRECONCILED) {
      throw new BadRequestException(`Transaction ${txnId} is not UNRECONCILED`);
    }

    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, tenantId },
    });
    if (!payment) throw new NotFoundException(`Payment ${paymentId} not found`);
    if (payment.status !== 'SUBMITTED') {
      throw new BadRequestException(`Payment ${paymentId} is not SUBMITTED`);
    }
    if (payment.reconciledAt !== null) {
      throw new BadRequestException(`Payment ${paymentId} is already reconciled`);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const txnClaim = await tx.bankTransaction.updateMany({
        where: { id: txnId, tenantId, status: BankTxnStatus.UNRECONCILED },
        data: { status: BankTxnStatus.RECONCILED, matchedPaymentId: paymentId },
      });
      if (txnClaim.count === 0) throw new ConflictException('Transaction changed concurrently');

      const paymentClaim = await tx.payment.updateMany({
        where: { id: paymentId, tenantId, reconciledAt: null },
        data: { reconciledAt: new Date() },
      });
      if (paymentClaim.count === 0) throw new ConflictException('Payment changed concurrently');

      return tx.bankTransaction.findFirst({ where: { id: txnId } });
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.UPDATE,
      entityType: 'bank-transaction',
      entityId: txnId,
      before: { status: BankTxnStatus.UNRECONCILED },
      after: { status: BankTxnStatus.RECONCILED, matchedPaymentId: paymentId },
    });

    return updated;
  }

  async unmatch(tenantId: string, userId: string, txnId: string) {
    const txn = await this.prisma.bankTransaction.findFirst({
      where: { id: txnId, tenantId },
    });
    if (!txn) throw new NotFoundException(`BankTransaction ${txnId} not found`);
    if (txn.status !== BankTxnStatus.RECONCILED) {
      throw new BadRequestException(`Transaction ${txnId} is not RECONCILED`);
    }
    if (!txn.matchedPaymentId) {
      throw new BadRequestException(`Transaction ${txnId} has no matched payment`);
    }

    const matchedPaymentId = txn.matchedPaymentId;

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.bankTransaction.updateMany({
        where: { id: txnId, tenantId },
        data: { status: BankTxnStatus.UNRECONCILED, matchedPaymentId: null },
      });

      await tx.payment.updateMany({
        where: { id: matchedPaymentId, tenantId },
        data: { reconciledAt: null },
      });

      return tx.bankTransaction.findFirst({ where: { id: txnId } });
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.UPDATE,
      entityType: 'bank-transaction',
      entityId: txnId,
      before: { status: BankTxnStatus.RECONCILED, matchedPaymentId },
      after: { status: BankTxnStatus.UNRECONCILED, matchedPaymentId: null },
    });

    return updated;
  }
}
