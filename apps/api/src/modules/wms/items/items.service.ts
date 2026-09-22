import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { computeReplenishment } from '@pulsar/shared';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { paginated, paginationArgs } from '../../../common/pagination';
import { OwnershipService } from '../../../prisma/ownership.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateItemDto, UpdateItemDto } from './dto/item.dto';

@Injectable()
export class ItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
  ) {}

  async list(tenantId: string, query: ListQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where: Prisma.WmsItemWhereInput = {
      tenantId,
      ...(query.search
        ? {
            OR: [
              { sku: { contains: query.search, mode: 'insensitive' } },
              { name: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.wmsItem.findMany({ where, skip, take, orderBy: { sku: 'asc' } }),
      this.prisma.wmsItem.count({ where }),
    ]);
    const onHand = await this.onHandMap(
      tenantId,
      items.map((i) => i.id),
    );
    const withRepl = items.map((i) => {
      const oh = onHand.get(i.id) ?? 0;
      return {
        ...i,
        onHand: oh,
        replenishment: computeReplenishment({
          onHand: oh,
          reorderPoint: i.reorderPoint,
          reorderQty: i.reorderQty,
        }),
      };
    });
    return paginated(withRepl, total, page, pageSize);
  }

  /** Sum on-hand per item across all bins (batched). */
  private async onHandMap(tenantId: string, itemIds: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (itemIds.length === 0) return map;
    const rows = await this.prisma.inventoryLevel.groupBy({
      by: ['itemId'],
      where: { tenantId, itemId: { in: itemIds } },
      _sum: { qtyOnHand: true },
    });
    for (const r of rows) map.set(r.itemId, Number(r._sum.qtyOnHand ?? 0));
    return map;
  }

  async get(tenantId: string, id: string) {
    const item = await this.prisma.wmsItem.findFirst({ where: { id, tenantId } });
    if (!item) throw new NotFoundException('Item not found');
    const onHand = (await this.onHandMap(tenantId, [id])).get(id) ?? 0;
    return {
      ...item,
      onHand,
      replenishment: computeReplenishment({
        onHand,
        reorderPoint: item.reorderPoint,
        reorderQty: item.reorderQty,
      }),
    };
  }

  async create(tenantId: string, userId: string, dto: CreateItemDto) {
    try {
      return await this.prisma.wmsItem.create({
        data: { ...dto, tenantId, createdById: userId },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('SKU already exists');
      }
      throw err;
    }
  }

  async update(tenantId: string, id: string, dto: UpdateItemDto) {
    await this.get(tenantId, id);
    try {
      await this.prisma.$transaction(async (tx) => {
        // Same stock lock as Services issues/mapping and InventoryService.postMovement.
        await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
        const old = await tx.wmsItem.findFirstOrThrow({ where: { tenantId, id } });
        if (
          dto.unit !== undefined &&
          dto.unit !== old.unit &&
          ((await tx.catalogStockLink.count({ where: { tenantId, wmsItemId: id } })) ||
            (await tx.servicePartUsage.count({ where: { tenantId, wmsItemId: id } })) ||
            (await tx.supplierReceiptLine.count({
              where: { tenantId, receiptLine: { tenantId, itemId: id } },
            })))
        )
          throw new ConflictException(
            'L’unité est figée par une correspondance Catalogue, une consommation Services ou une réception fournisseur.',
          );
        await tx.wmsItem.updateMany({ where: { id, tenantId }, data: dto });
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('SKU already exists');
      }
      throw err;
    }
    return this.get(tenantId, id);
  }
}
