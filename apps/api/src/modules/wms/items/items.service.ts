import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
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
    return paginated(items, total, page, pageSize);
  }

  async get(tenantId: string, id: string) {
    const item = await this.prisma.wmsItem.findFirst({ where: { id, tenantId } });
    if (!item) throw new NotFoundException('Item not found');
    return item;
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
      await this.prisma.wmsItem.updateMany({ where: { id, tenantId }, data: dto });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('SKU already exists');
      }
      throw err;
    }
    return this.get(tenantId, id);
  }
}
