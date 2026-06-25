import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  FixedAssetStatus,
  buildDepreciationSchedule,
  canTransitionFixedAsset,
  depreciationForNextPeriod,
} from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { LedgerService } from '../ledger/ledger.service';
import { CreateFixedAssetDto, UpdateFixedAssetDto } from './dto/fixed-asset.dto';

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

@Injectable()
export class FixedAssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly ledger: LedgerService,
  ) {}

  list(tenantId: string) {
    return this.prisma.fixedAsset.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(tenantId: string, id: string) {
    const asset = await this.prisma.fixedAsset.findFirst({ where: { id, tenantId } });
    if (!asset) throw new NotFoundException('Fixed asset not found');
    return asset;
  }

  async create(tenantId: string, userId: string, dto: CreateFixedAssetDto) {
    const asset = await this.prisma.fixedAsset.create({
      data: {
        tenantId,
        assetCode: dto.assetCode,
        name: dto.name,
        category: dto.category,
        acquisitionDate: new Date(dto.acquisitionDate),
        cost: new Prisma.Decimal(dto.cost),
        salvageValue: new Prisma.Decimal(dto.salvageValue ?? 0),
        usefulLifeMonths: dto.usefulLifeMonths,
        ...(dto.depreciationExpenseAccountCode
          ? { depreciationExpenseAccountCode: dto.depreciationExpenseAccountCode }
          : {}),
        ...(dto.accumulatedDepreciationAccountCode
          ? { accumulatedDepreciationAccountCode: dto.accumulatedDepreciationAccountCode }
          : {}),
      },
    });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.CREATE,
      entityType: 'fixed-asset',
      entityId: asset.id,
      after: { assetCode: asset.assetCode, status: asset.status },
    });
    return asset;
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdateFixedAssetDto) {
    const existing = await this.prisma.fixedAsset.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Fixed asset not found');

    const data: Prisma.FixedAssetUpdateInput = {};
    if (dto.assetCode !== undefined) data.assetCode = dto.assetCode;
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.category !== undefined) data.category = dto.category;
    if (dto.acquisitionDate !== undefined) data.acquisitionDate = new Date(dto.acquisitionDate);
    if (dto.cost !== undefined) data.cost = new Prisma.Decimal(dto.cost);
    if (dto.salvageValue !== undefined) data.salvageValue = new Prisma.Decimal(dto.salvageValue);
    if (dto.usefulLifeMonths !== undefined) data.usefulLifeMonths = dto.usefulLifeMonths;
    if (dto.depreciationExpenseAccountCode !== undefined)
      data.depreciationExpenseAccountCode = dto.depreciationExpenseAccountCode;
    if (dto.accumulatedDepreciationAccountCode !== undefined)
      data.accumulatedDepreciationAccountCode = dto.accumulatedDepreciationAccountCode;

    const updated = await this.prisma.fixedAsset.update({ where: { id }, data });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.UPDATE,
      entityType: 'fixed-asset',
      entityId: id,
      after: data,
    });
    return updated;
  }

  async remove(tenantId: string, userId: string, id: string) {
    const existing = await this.prisma.fixedAsset.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Fixed asset not found');
    if (existing.status !== FixedAssetStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT assets can be deleted');
    }
    await this.prisma.fixedAsset.delete({ where: { id } });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.DELETE,
      entityType: 'fixed-asset',
      entityId: id,
      before: { assetCode: existing.assetCode, status: existing.status },
    });
  }

  async schedule(tenantId: string, id: string) {
    const asset = await this.prisma.fixedAsset.findFirst({ where: { id, tenantId } });
    if (!asset) throw new NotFoundException('Fixed asset not found');
    return buildDepreciationSchedule({
      cost: Number(asset.cost),
      salvageValue: Number(asset.salvageValue),
      usefulLifeMonths: asset.usefulLifeMonths,
    });
  }

  async activate(tenantId: string, userId: string, id: string) {
    if (!canTransitionFixedAsset(FixedAssetStatus.DRAFT, FixedAssetStatus.ACTIVE)) {
      throw new BadRequestException('Only DRAFT assets can be activated');
    }
    const result = await this.prisma.fixedAsset.updateMany({
      where: { id, tenantId, status: FixedAssetStatus.DRAFT },
      data: { status: FixedAssetStatus.ACTIVE },
    });
    if (result.count === 0) {
      throw new BadRequestException('Only DRAFT assets can be activated');
    }
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'fixed-asset',
      entityId: id,
      before: { status: FixedAssetStatus.DRAFT },
      after: { status: FixedAssetStatus.ACTIVE },
    });
    return this.prisma.fixedAsset.findFirst({ where: { id, tenantId } });
  }

  async dispose(tenantId: string, userId: string, id: string) {
    const asset = await this.prisma.fixedAsset.findFirst({ where: { id, tenantId } });
    if (!asset) throw new NotFoundException('Fixed asset not found');
    const currentStatus = asset.status as FixedAssetStatus;
    if (!canTransitionFixedAsset(currentStatus, FixedAssetStatus.DISPOSED)) {
      throw new BadRequestException(
        `Cannot dispose a ${currentStatus} asset`,
      );
    }
    const result = await this.prisma.fixedAsset.updateMany({
      where: { id, tenantId, status: currentStatus },
      data: { status: FixedAssetStatus.DISPOSED, disposedAt: new Date() },
    });
    if (result.count === 0) {
      throw new ConflictException('Asset status changed concurrently');
    }
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'fixed-asset',
      entityId: id,
      before: { status: currentStatus },
      after: { status: FixedAssetStatus.DISPOSED },
    });
    return this.prisma.fixedAsset.findFirst({ where: { id, tenantId } });
  }

  /**
   * Post a depreciation entry for the given period.
   *
   * CRITICAL path — rule 41:
   * - amount derived from `depreciationForNextPeriod` (pure, @pulsar/shared), never re-implemented.
   * - Transaction: create DepreciationEntry (unique(tenant,asset,period) → P2002 → 409) +
   *   increment accumulatedDepreciation + post GL via ledger.postTx (Dr expense / Cr contra-asset).
   * - GL lines are balanced (debit === credit === amount).
   * - Audit after commit (best-effort, never blocks the tx).
   */
  async depreciate(tenantId: string, userId: string, id: string, periodIso: string) {
    const asset = await this.prisma.fixedAsset.findFirst({ where: { id, tenantId } });
    if (!asset) throw new NotFoundException('Fixed asset not found');
    if (asset.status !== FixedAssetStatus.ACTIVE) {
      throw new BadRequestException('Only ACTIVE assets can be depreciated');
    }

    const accumulated = Number(asset.accumulatedDepreciation);
    const amount = depreciationForNextPeriod({
      cost: Number(asset.cost),
      salvageValue: Number(asset.salvageValue),
      usefulLifeMonths: asset.usefulLifeMonths,
      accumulated,
    });
    if (amount <= 0) {
      throw new BadRequestException('Asset is fully depreciated');
    }

    // Normalize to UTC first of month
    const d = new Date(periodIso);
    const period = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

    // Ensure the chart of accounts exists before the transaction (same pattern as PaymentsService)
    await this.ledger.ensureChart(tenantId);

    let entryId: string;

    await this.prisma.$transaction(async (tx: any) => {
      // 1. Create DepreciationEntry — catch P2002 (unique constraint) as idempotence guard
      let entry: { id: string };
      try {
        entry = await tx.depreciationEntry.create({
          data: {
            tenantId,
            assetId: id,
            period,
            amount: new Prisma.Decimal(amount),
          },
          select: { id: true },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ConflictException('Period already depreciated');
        }
        throw err;
      }

      entryId = entry.id;

      // 2. Increment accumulatedDepreciation on the asset
      await tx.fixedAsset.updateMany({
        where: { id, tenantId },
        data: { accumulatedDepreciation: new Prisma.Decimal(round2(accumulated + amount)) },
      });

      // 3. Post GL: Dr depreciationExpenseAccountCode / Cr accumulatedDepreciationAccountCode
      //    sourceType='depreciation', sourceId=entry.id — idempotent per rule 41
      await this.ledger.postTx(
        tx,
        tenantId,
        {
          date: period,
          memo: `Depreciation ${asset.assetCode} ${period.toISOString().slice(0, 7)}`,
          sourceType: 'depreciation',
          sourceId: entry.id,
          lines: [
            { accountCode: asset.depreciationExpenseAccountCode, debit: amount },
            { accountCode: asset.accumulatedDepreciationAccountCode, credit: amount },
          ],
        },
        userId,
      );
    });

    // Audit after commit (rule 6 — best-effort, never blocks)
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.UPDATE,
      entityType: 'fixed-asset',
      entityId: id,
      after: { period: period.toISOString(), amount, entryId: entryId! },
    });

    return this.prisma.fixedAsset.findFirst({ where: { id, tenantId } });
  }
}
