import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  AuditAction,
  BankTxnStatus,
  bankRowIdentity,
  inspectBankCsv,
  type BankCsvPreview,
  type BankCsvImportResult,
} from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { PrismaService } from '../../../prisma/prisma.service';
import { OwnershipService } from '../../../prisma/ownership.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { PreviewBankCsvDto, ImportBankCsvDto } from './dto/bank-transaction.dto';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class BankCsvService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly audit: AuditLogsService,
  ) {}

  private async inspect(
    tenantId: string,
    dto: PreviewBankCsvDto,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<BankCsvPreview> {
    const account = await db.bankAccount.findFirst({
      where: { id: dto.bankAccountId, tenantId },
      select: { id: true, currency: true, glAccountCode: true },
    });
    if (!account) throw new NotFoundException('Compte bancaire introuvable.');
    const parsed = inspectBankCsv(dto.csv);
    const identities = parsed.rows.map(bankRowIdentity),
      fingerprints = identities.map(hash);
    const dates = parsed.rows.map((r) => r.date).sort();
    const end = dates.length ? new Date(`${dates[dates.length - 1]}T00:00:00.000Z`) : null;
    end?.setUTCDate(end.getUTCDate() + 1);
    const existing = fingerprints.length
      ? await db.bankTransaction.findMany({
          where: {
            tenantId,
            bankAccountId: account.id,
            OR: [
              { importFingerprint: { in: fingerprints } },
              {
                importFingerprint: null,
                date: { gte: new Date(`${dates[0]}T00:00:00.000Z`), lt: end! },
              },
            ],
          },
          select: {
            date: true,
            amount: true,
            description: true,
            reference: true,
            importFingerprint: true,
          },
        })
      : [];
    const known = new Set(
      existing.map(
        (r) =>
          r.importFingerprint ??
          hash(
            bankRowIdentity({
              date: r.date.toISOString().slice(0, 10),
              amount: Number(r.amount),
              description: r.description,
              reference: r.reference ?? undefined,
            }),
          ),
      ),
    );
    const seen = new Set<string>();
    const rows: BankCsvPreview['rows'] = parsed.rows.map((row, i) => {
      const key = fingerprints[i];
      const status = known.has(key)
        ? 'DUPLICATE_EXISTING'
        : seen.has(key)
          ? 'DUPLICATE_FILE'
          : 'NEW';
      seen.add(key);
      return { ...row, status };
    });
    const fresh = rows.filter((r) => r.status === 'NEW');
    const sum = (positive: boolean) =>
      fresh
        .filter((r) => (positive ? r.amount > 0 : r.amount < 0))
        .reduce((total, r) => total + Math.abs(Math.round(r.amount * 100)), 0) / 100;
    return {
      bankAccountId: account.id,
      currency: account.currency,
      // Binds the preview to its content and account configuration, not to mutable duplicate counts.
      // A concurrent import can only reduce the number of inserted rows at commit.
      previewHash: hash(
        JSON.stringify([
          'bank-csv-v1',
          tenantId,
          account.id,
          account.currency,
          account.glAccountCode,
          dto.csv,
        ]),
      ),
      rows,
      issues: parsed.issues,
      errors: parsed.errors,
      canImport: !parsed.issues.length && fresh.length > 0,
      totals: {
        newCount: fresh.length,
        duplicateCount: rows.length - fresh.length,
        invalidCount: parsed.issues.length,
        credits: sum(true),
        debits: sum(false),
      },
    };
  }

  async preview(tenantId: string, dto: PreviewBankCsvDto): Promise<BankCsvPreview> {
    await this.ownership.assertOwned('bankAccount', dto.bankAccountId, tenantId);
    return this.inspect(tenantId, dto);
  }

  async import(
    tenantId: string,
    userId: string,
    dto: ImportBankCsvDto,
  ): Promise<BankCsvImportResult> {
    await this.ownership.assertOwned('bankAccount', dto.bankAccountId, tenantId);
    const result = await this.prisma.$transaction(async (tx) => {
      // Same lock as manual intake and account configuration: legacy-row checks cannot race a write.
      await tx.$queryRaw`SELECT id FROM bank_accounts WHERE id = ${dto.bankAccountId} AND "tenantId" = ${tenantId} FOR UPDATE`;
      const preview = await this.inspect(tenantId, dto, tx);
      if (dto.previewHash && dto.previewHash !== preview.previewHash)
        throw new ConflictException('Le contenu ou le compte a changé. Prévisualisez de nouveau.');
      if (preview.errors.length)
        throw new BadRequestException({
          message: 'Corrigez les lignes invalides. Aucun mouvement n’a été importé.',
          errors: preview.errors,
        });
      const rows = preview.rows.filter((r) => r.status === 'NEW');
      const inserted = rows.length
        ? await tx.bankTransaction.createMany({
            data: rows.map((r) => ({
              tenantId,
              bankAccountId: dto.bankAccountId,
              date: new Date(`${r.date}T00:00:00.000Z`),
              amount: new Prisma.Decimal(r.amount),
              description: r.description,
              reference: r.reference ?? null,
              status: BankTxnStatus.UNRECONCILED,
              importFingerprint: hash(bankRowIdentity(r)),
            })),
            skipDuplicates: true,
          })
        : { count: 0 };
      return {
        imported: inserted.count,
        skipped: preview.rows.length - inserted.count,
        errors: [],
      };
    });
    // Summary only: never copy CSV contents or banking descriptions into AuditLog.
    if (result.imported)
      await this.audit.log({
        tenantId,
        userId,
        action: AuditAction.CREATE,
        entityType: 'bank-import',
        entityId: dto.bankAccountId,
        after: {
          bankAccountId: dto.bankAccountId,
          imported: result.imported,
          skipped: result.skipped,
          contentHash: hash(dto.csv),
        },
      });
    return result;
  }
}
