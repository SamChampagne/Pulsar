import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, BankTxnStatus, bankMatchError, canTransitionBankTxn } from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { OwnershipService } from '../../../prisma/ownership.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { ModesOfPaymentService } from '../modes-of-payment.service';
import { CreateBankTransactionDto } from './dto/bank-transaction.dto';

@Injectable()
export class BankTransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly modes: ModesOfPaymentService,
    private readonly ownership: OwnershipService,
  ) {}

  private async assertAccountOwned(tenantId: string, bankAccountId: string) {
    const account = await this.prisma.bankAccount.findFirst({
      where: { id: bankAccountId, tenantId },
      select: { id: true, glAccountCode: true, currency: true },
    });
    if (!account) throw new NotFoundException(`BankAccount ${bankAccountId} not found`);
    return account;
  }

  list(tenantId: string, bankAccountId?: string, status?: BankTxnStatus, paymentId?: string) {
    return this.prisma.bankTransaction.findMany({
      where: {
        tenantId,
        ...(bankAccountId ? { bankAccountId } : {}),
        ...(status ? { status } : {}),
        ...(paymentId ? { matchedPaymentId: paymentId } : {}),
      },
      orderBy: { date: 'desc' },
    });
  }

  async create(tenantId: string, dto: CreateBankTransactionDto) {
    await this.ownership.assertOwned('bankAccount', dto.bankAccountId, tenantId);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM bank_accounts WHERE id = ${dto.bankAccountId} AND "tenantId" = ${tenantId} FOR UPDATE`;
      if (!(await tx.bankAccount.findFirst({ where: { id: dto.bankAccountId, tenantId } })))
        throw new NotFoundException('Compte bancaire introuvable.');
      return tx.bankTransaction.create({
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
    });
  }

  async reconciliation(tenantId: string, bankAccountId: string) {
    const account = await this.assertAccountOwned(tenantId, bankAccountId);

    const unreconciledTransactions = await this.prisma.bankTransaction.findMany({
      where: { tenantId, bankAccountId, status: BankTxnStatus.UNRECONCILED },
      orderBy: { date: 'desc' },
    });

    const allSubmitted = await this.prisma.payment.findMany({
      where: { tenantId, status: 'SUBMITTED', reconciledAt: null },
      include: {
        modeOfPayment: true,
        allocations: { where: { tenantId }, select: { amount: true } },
      },
    });

    const candidatePayments = allSubmitted.filter(
      (p) =>
        p.modeOfPayment?.accountCode === account.glAccountCode && p.currency === account.currency,
    );

    return {
      unreconciledTransactions,
      candidatePayments: candidatePayments.map((p) => ({
        ...p,
        allocatedAmount: p.allocations.reduce((sum, a) => sum + Number(a.amount), 0),
      })),
    };
  }

  async match(tenantId: string, userId: string, txnId: string, paymentId: string) {
    await this.ownership.assertOwned('payment', paymentId, tenantId);
    let changed = false;
    const updated = await this.prisma.$transaction(async (tx) => {
      // Global order: payment before bank transaction (shared with cancel/unmatch).
      await tx.$queryRaw`SELECT id FROM payments WHERE id = ${paymentId} AND "tenantId" = ${tenantId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM bank_transactions WHERE id = ${txnId} AND "tenantId" = ${tenantId} FOR UPDATE`;
      const txn = await tx.bankTransaction.findFirst({ where: { id: txnId, tenantId } });
      if (!txn) throw new NotFoundException('Transaction bancaire introuvable.');
      const payment = await tx.payment.findFirst({
        where: { id: paymentId, tenantId },
        include: { modeOfPayment: true, allocations: { where: { tenantId } } },
      });
      if (!payment || payment.status !== 'SUBMITTED')
        throw new BadRequestException('Le paiement doit être comptabilisé.');
      if (
        txn.status === BankTxnStatus.RECONCILED &&
        txn.matchedPaymentId === paymentId &&
        payment.reconciledAt
      )
        return txn;
      if (
        !canTransitionBankTxn(txn.status as BankTxnStatus, BankTxnStatus.RECONCILED) ||
        payment.reconciledAt
      )
        throw new ConflictException('Transaction ou paiement déjà rapproché.');
      await tx.$queryRaw`SELECT id FROM bank_accounts WHERE id = ${txn.bankAccountId} AND "tenantId" = ${tenantId} FOR SHARE`;
      const account = await tx.bankAccount.findFirst({
        where: { id: txn.bankAccountId, tenantId },
      });
      if (!account) throw new NotFoundException('Compte bancaire introuvable.');
      const reason = bankMatchError({
        transactionAmount: Number(txn.amount),
        paymentAmount: Number(payment.totalAmount),
        allocatedAmount: payment.allocations.reduce((sum, a) => sum + Number(a.amount), 0),
        bankCurrency: account.currency,
        paymentCurrency: payment.currency,
        bankAccountCode: account.glAccountCode,
        paymentAccountCode: payment.modeOfPayment.accountCode,
        paymentType: payment.type,
      });
      if (reason) throw new BadRequestException(reason);
      // Match the actual posted bank leg, not just the mutable mode configuration.
      const journal = await tx.journalEntry.findMany({
        where: { tenantId, sourceType: 'payment', sourceId: paymentId, sourceKind: null },
        include: {
          currencyQualification: { select: { state: true, currency: true, sourceEntryId: true } },
          lines: { where: { tenantId, account: { tenantId, code: account.glAccountCode } } },
        },
      });
      const posted = journal
        .flatMap((j) => j.lines)
        .reduce((sum, line) => sum.plus(line.debit).minus(line.credit), new Prisma.Decimal(0));
      if (
        journal.length !== 1 ||
        (journal[0].currency ??
          (journal[0].currencyQualification?.state === 'QUALIFIED' &&
          journal[0].currencyQualification.sourceEntryId === journal[0].id
            ? journal[0].currencyQualification.currency
            : null)) !== account.currency ||
        !posted.equals(txn.amount)
      )
        throw new BadRequestException(
          'L’écriture bancaire du paiement est absente ou son montant/devise ne correspond pas au mouvement. Une devise historique inconnue exige une revue.',
        );
      const txnClaim = await tx.bankTransaction.updateMany({
        where: { id: txnId, tenantId, status: BankTxnStatus.UNRECONCILED, matchedPaymentId: null },
        data: { status: BankTxnStatus.RECONCILED, matchedPaymentId: paymentId },
      });
      if (!txnClaim.count) throw new ConflictException('Transaction modifiée simultanément.');
      const paymentClaim = await tx.payment.updateMany({
        where: { id: paymentId, tenantId, status: 'SUBMITTED', reconciledAt: null },
        data: { reconciledAt: new Date() },
      });
      if (!paymentClaim.count) throw new ConflictException('Paiement modifié simultanément.');
      changed = true;
      return tx.bankTransaction.findFirstOrThrow({ where: { id: txnId, tenantId } });
    });

    if (changed)
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
      await tx.$queryRaw`SELECT id FROM payments WHERE id = ${matchedPaymentId} AND "tenantId" = ${tenantId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM bank_transactions WHERE id = ${txnId} AND "tenantId" = ${tenantId} FOR UPDATE`;
      const current = await tx.bankTransaction.findFirst({ where: { id: txnId, tenantId } });
      if (
        !current ||
        current.matchedPaymentId !== matchedPaymentId ||
        !canTransitionBankTxn(current.status as BankTxnStatus, BankTxnStatus.UNRECONCILED)
      )
        throw new ConflictException('Le rapprochement a changé. Rechargez le dossier.');
      const claim = await tx.bankTransaction.updateMany({
        where: { id: txnId, tenantId, status: BankTxnStatus.RECONCILED, matchedPaymentId },
        data: { status: BankTxnStatus.UNRECONCILED, matchedPaymentId: null },
      });
      if (!claim.count) throw new ConflictException('Le rapprochement a changé.');
      await tx.payment.updateMany({
        where: { id: matchedPaymentId, tenantId },
        data: { reconciledAt: null },
      });
      return tx.bankTransaction.findFirstOrThrow({ where: { id: txnId, tenantId } });
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
