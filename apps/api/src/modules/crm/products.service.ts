import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { PrismaService } from '../../prisma/prisma.service';
import { paginationArgs, paginated } from '../../common/pagination';
import { AuditLogsService } from '../../core/audit-logs/audit-logs.service';
import { CreateProductDto, ProductListQueryDto, UpdateProductDto } from './dto/product.dto';

/**
 * CRM products catalog service. All operations are tenant-scoped (rule 1).
 * Delete is guarded: 409 if the product is referenced by any deal line item.
 * customData is stored as-is (no CustomFieldEntity defined for CRM_PRODUCT yet).
 */
@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async list(tenantId: string, query: ProductListQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where = {
      tenantId,
      ...(query.active === 'true' ? { active: true } : query.active === 'false' ? { active: false } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' as const } },
              { sku: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.crmProduct.findMany({ where, orderBy: { name: 'asc' }, skip, take }),
      this.prisma.crmProduct.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  async get(tenantId: string, id: string) {
    const product = await this.prisma.crmProduct.findFirst({ where: { id, tenantId } });
    if (!product) throw new NotFoundException('CRM product not found');
    return product;
  }

  async create(tenantId: string, userId: string, dto: CreateProductDto) {
    const product = await this.prisma.crmProduct.create({
      data: {
        tenantId,
        name: dto.name,
        sku: dto.sku ?? null,
        description: dto.description ?? null,
        unitPrice: dto.unitPrice ?? 0,
        currency: dto.currency ?? 'CAD',
        active: dto.active ?? true,
        ...(dto.customData !== undefined ? { customData: dto.customData as Prisma.InputJsonValue } : {}),
      },
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.CREATE,
      entityType: 'crm-product',
      entityId: product.id,
      after: { name: product.name, unitPrice: dto.unitPrice },
    });

    return product;
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdateProductDto) {
    const { count } = await this.prisma.crmProduct.updateMany({
      where: { id, tenantId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.sku !== undefined ? { sku: dto.sku } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.unitPrice !== undefined ? { unitPrice: dto.unitPrice } : {}),
        ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        ...(dto.customData !== undefined ? { customData: dto.customData as Prisma.InputJsonValue } : {}),
      },
    });
    if (count === 0) throw new NotFoundException('CRM product not found');

    const product = await this.get(tenantId, id);

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.UPDATE,
      entityType: 'crm-product',
      entityId: id,
      after: { name: product.name, active: product.active },
    });

    return product;
  }

  async remove(tenantId: string, userId: string, id: string) {
    const product = await this.prisma.crmProduct.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!product) throw new NotFoundException('CRM product not found');

    const refs = await this.prisma.crmDealLineItem.count({ where: { tenantId, productId: id } });
    if (refs > 0) throw new ConflictException('Product is referenced by deal line items');

    await this.prisma.crmProduct.delete({ where: { id } });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.DELETE,
      entityType: 'crm-product',
      entityId: id,
    });

    return { ok: true };
  }
}
