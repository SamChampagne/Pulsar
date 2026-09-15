import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { AuditAction, MODULE_KEYS } from '@pulsar/shared';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { paginated, paginationArgs } from '../../../common/pagination';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { TenantModulesCacheService } from '../../../prisma/tenant-modules-cache.service';
import { artifactHash } from '../scheduling/aps-artifact';
import { CreateBomDto, CreateBomLineDto, UpdateBomDto, UpdateBomLineDto } from './dto/bom.dto';

export const revisionSummary = {
  id: true,
  revision: true,
  code: true,
  name: true,
  outputItemId: true,
  outputSku: true,
  outputName: true,
  outputUnit: true,
  validFrom: true,
  validUntil: true,
  createdAt: true,
  contentHash: true,
} as const;

@Injectable()
export class BomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modules: TenantModulesCacheService,
    private readonly audit: AuditLogsService,
  ) {}

  async list(tenantId: string, query: ListQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where: Prisma.BomWhereInput = {
      tenantId,
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' as const } },
              { code: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.bom.findMany({
        where,
        skip,
        take,
        orderBy: { name: 'asc' },
        include: {
          _count: { select: { lines: { where: { tenantId } } } },
          revisions: {
            where: { tenantId },
            orderBy: { revision: 'desc' },
            take: 1,
            select: revisionSummary,
          },
        },
      }),
      this.prisma.bom.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  async get(tenantId: string, id: string) {
    const bom = await this.prisma.bom.findFirst({
      where: { id, tenantId },
      include: {
        lines: { where: { tenantId }, orderBy: { id: 'asc' } },
        revisions: {
          where: { tenantId },
          orderBy: { revision: 'desc' },
          take: 30,
          select: revisionSummary,
        },
      },
    });
    if (!bom) throw new NotFoundException('Nomenclature introuvable.');
    return bom;
  }

  async revision(tenantId: string, bomId: string, id: string) {
    const revision = await this.prisma.bomRevision.findFirst({
      where: { id, bomId, tenantId },
      include: { lines: { where: { tenantId }, orderBy: { sku: 'asc' } } },
    });
    if (!revision) throw new NotFoundException('Version introuvable.');
    return revision;
  }

  async create(tenantId: string, dto: CreateBomDto) {
    if (!dto.code.trim() || !dto.name.trim())
      throw new BadRequestException('Code et nom obligatoires.');
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
        return tx.bom.create({
          data: {
            ...dto,
            code: dto.code.trim(),
            name: dto.name.trim(),
            productRef: dto.productRef?.trim(),
            tenantId,
          },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('Code déjà utilisé.');
      throw error;
    }
  }

  private locked<T>(
    tenantId: string,
    id: string,
    expected: string | undefined,
    fn: (
      tx: Prisma.TransactionClient,
      bom: {
        id: string;
        updatedAt: Date;
        isActive: boolean;
        productRef: string | null;
        code: string;
        name: string;
      },
    ) => Promise<T>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // Shared with WMS stock/unit writers and MRP policies.
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
      const bom = await tx.bom.findFirst({ where: { id, tenantId } });
      if (!bom) throw new NotFoundException('Nomenclature introuvable.');
      if (!expected || bom.updatedAt.getTime() !== new Date(expected).getTime())
        throw new ConflictException(
          'La nomenclature a changé. Rechargez avant de modifier ou publier.',
        );
      return fn(tx, bom);
    });
  }

  private advance(tx: Prisma.TransactionClient, tenantId: string, id: string, previous: Date) {
    return tx.bom.updateMany({
      where: { id, tenantId },
      data: { updatedAt: new Date(Math.max(Date.now(), previous.getTime() + 1)) },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateBomDto) {
    await this.locked(tenantId, id, dto.expectedUpdatedAt, async (tx, bom) => {
      const { code: _code, expectedUpdatedAt: _version, ...data } = dto;
      if (data.name !== undefined && (typeof data.name !== 'string' || !data.name.trim()))
        throw new BadRequestException('Nom obligatoire.');
      await tx.bom.updateMany({
        where: { id, tenantId },
        data: { ...data, productRef: data.productRef?.trim() },
      });
      await this.advance(tx, tenantId, id, bom.updatedAt);
    });
    return this.get(tenantId, id);
  }

  async remove(tenantId: string, id: string, expected?: string) {
    return this.locked(tenantId, id, expected, async (tx) => {
      const used = await Promise.all([
        tx.bomRevision.count({ where: { tenantId, bomId: id } }),
        tx.mrpItemPolicy.count({ where: { tenantId, bomId: id } }),
        tx.manufacturingOrder.count({ where: { tenantId, bomId: id } }),
      ]);
      if (used.some(Boolean))
        throw new ConflictException(
          'Nomenclature utilisée : désactivez-la au lieu de la supprimer.',
        );
      await tx.bom.deleteMany({ where: { id, tenantId } });
      return { success: true };
    });
  }

  private quantity(value = '1') {
    if (typeof value !== 'string' || !/^\d{1,15}(\.\d{1,9})?$/.test(value))
      throw new BadRequestException('Quantité décimale invalide.');
    const quantity = new Prisma.Decimal(value);
    if (!quantity.isFinite() || quantity.lte(0) || quantity.gt(1e9) || quantity.decimalPlaces() > 9)
      throw new BadRequestException('Quantité positive, maximum 1 milliard et 9 décimales.');
    return quantity;
  }

  async addLine(tenantId: string, bomId: string, dto: CreateBomLineDto) {
    return this.locked(tenantId, bomId, dto.expectedUpdatedAt, async (tx, bom) => {
      if (!dto.materialRef.trim()) throw new BadRequestException('SKU obligatoire.');
      if ((await tx.bomLine.count({ where: { tenantId, bomId } })) >= 500)
        throw new BadRequestException('Maximum 500 composants.');
      const line = await tx.bomLine.create({
        data: {
          tenantId,
          bomId,
          materialRef: dto.materialRef.trim(),
          materialName: dto.materialName,
          quantityPerUnit: this.quantity(dto.quantityPerUnit),
        },
      });
      await this.advance(tx, tenantId, bomId, bom.updatedAt);
      return line;
    });
  }

  async updateLine(tenantId: string, bomId: string, lineId: string, dto: UpdateBomLineDto) {
    return this.locked(tenantId, bomId, dto.expectedUpdatedAt, async (tx, bom) => {
      if (
        dto.materialRef !== undefined &&
        (typeof dto.materialRef !== 'string' || !dto.materialRef.trim())
      )
        throw new BadRequestException('SKU obligatoire.');
      const { count } = await tx.bomLine.updateMany({
        where: { id: lineId, bomId, tenantId },
        data: {
          materialRef: dto.materialRef?.trim(),
          materialName: dto.materialName,
          ...(dto.quantityPerUnit !== undefined
            ? { quantityPerUnit: this.quantity(dto.quantityPerUnit) }
            : {}),
        },
      });
      if (!count) throw new NotFoundException('Composant introuvable.');
      await this.advance(tx, tenantId, bomId, bom.updatedAt);
      return tx.bomLine.findFirstOrThrow({ where: { id: lineId, bomId, tenantId } });
    });
  }

  async removeLine(tenantId: string, bomId: string, lineId: string, expected?: string) {
    return this.locked(tenantId, bomId, expected, async (tx, bom) => {
      const { count } = await tx.bomLine.deleteMany({ where: { id: lineId, bomId, tenantId } });
      if (!count) throw new NotFoundException('Composant introuvable.');
      await this.advance(tx, tenantId, bomId, bom.updatedAt);
      return { success: true };
    });
  }

  async publish(
    tenantId: string,
    userId: string,
    id: string,
    expected?: string,
    validity: { validFrom?: string; validUntil?: string } = {},
  ) {
    if (validity.validFrom && validity.validUntil && validity.validFrom > validity.validUntil)
      throw new BadRequestException('La fin de validité doit suivre le début.');
    const enabled = await this.modules.getEnabledKeys(tenantId);
    if (!enabled.has(MODULE_KEYS.WMS) || !enabled.has(MODULE_KEYS.MANUFACTURING))
      throw new ForbiddenException('Fabrication et WMS requis pour publier.');
    const result = await this.locked(tenantId, id, expected, async (tx, bom) => {
      if (!bom.isActive || !bom.productRef)
        throw new BadRequestException('Nomenclature active et SKU produit requis.');
      const draft = await tx.bomLine.findMany({
        where: { tenantId, bomId: id },
        orderBy: { id: 'asc' },
        take: 501,
      });
      if (!draft.length || draft.length > 500)
        throw new BadRequestException('De 1 à 500 composants requis.');
      const items = await tx.wmsItem.findMany({
        where: {
          tenantId,
          isActive: true,
          sku: { in: [bom.productRef, ...draft.map((l) => l.materialRef)] },
        },
      });
      const bySku = new Map(items.map((item) => [item.sku, item]));
      const output = bySku.get(bom.productRef);
      if (!output?.unit.trim())
        throw new BadRequestException('Le produit doit être un article WMS actif avec unité.');
      const lines = draft.map((line) => {
        const item = bySku.get(line.materialRef);
        if (!item?.unit.trim() || item.id === output.id)
          throw new BadRequestException(
            `Composant invalide : ${line.materialRef} (article actif, unité, distinct du produit).`,
          );
        return {
          itemId: item.id,
          sku: item.sku,
          name: item.name,
          unit: item.unit,
          quantityPerUnit: this.quantity(line.quantityPerUnit.toFixed()).toFixed(),
        };
      });
      const header = {
        validFrom: validity.validFrom ? new Date(validity.validFrom) : null,
        validUntil: validity.validUntil ? new Date(validity.validUntil) : null,
        code: bom.code,
        name: bom.name,
        outputItemId: output.id,
        outputSku: output.sku,
        outputName: output.name,
        outputUnit: output.unit,
      };
      const contentHash = artifactHash({ ...header, lines });
      const last = await tx.bomRevision.findFirst({
        where: { tenantId, bomId: id },
        orderBy: { revision: 'desc' },
      });
      if (last?.contentHash === contentHash) return { revision: last, created: false };
      const revision = await tx.bomRevision.create({
        data: {
          tenantId,
          bomId: id,
          revision: (last?.revision ?? 0) + 1,
          ...header,
          contentHash,
          createdById: userId,
          lines: { create: lines.map((line) => ({ ...line, tenantId })) },
        },
      });
      return { revision, created: true };
    });
    if (result.created)
      await this.audit.log({
        tenantId,
        userId,
        action: AuditAction.CREATE,
        entityType: 'bom-revision',
        entityId: result.revision.id,
        after: {
          bomId: id,
          revision: result.revision.revision,
          contentHash: result.revision.contentHash,
        },
      });
    return this.revision(tenantId, id, result.revision.id);
  }
}
