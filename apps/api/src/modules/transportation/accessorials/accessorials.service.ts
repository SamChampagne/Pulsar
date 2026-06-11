import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { paginated, paginationArgs } from '../../../common/pagination';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateAccessorialDto, UpdateAccessorialDto } from './dto/accessorial.dto';

@Injectable()
export class AccessorialsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, query: ListQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where: Prisma.AccessorialWhereInput = {
      tenantId,
      ...(query.search
        ? {
            OR: [
              { code: { contains: query.search, mode: 'insensitive' } },
              { name: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.accessorial.findMany({ where, skip, take, orderBy: { code: 'asc' } }),
      this.prisma.accessorial.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  async get(tenantId: string, id: string) {
    const row = await this.prisma.accessorial.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('Accessorial not found');
    return row;
  }

  async create(tenantId: string, dto: CreateAccessorialDto) {
    try {
      return await this.prisma.accessorial.create({ data: { tenantId, ...dto } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`Accessorial code "${dto.code}" already exists`);
      }
      throw e;
    }
  }

  async update(tenantId: string, id: string, dto: UpdateAccessorialDto) {
    await this.get(tenantId, id);
    try {
      return await this.prisma.accessorial.update({ where: { id }, data: dto });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`Accessorial code "${dto.code}" already exists`);
      }
      throw e;
    }
  }

  /** Restrict policy: refuse deletion while rate prices or load flags reference it. */
  async remove(tenantId: string, id: string) {
    await this.get(tenantId, id);
    const [ratePrices, loadFlags] = await this.prisma.$transaction([
      this.prisma.rateAccessorialPrice.count({ where: { accessorialId: id } }),
      this.prisma.loadAccessorial.count({ where: { accessorialId: id } }),
    ]);
    if (ratePrices > 0 || loadFlags > 0) {
      throw new ConflictException(
        `Accessorial is referenced by ${ratePrices} rate price(s) and ${loadFlags} load flag(s) — remove them first`,
      );
    }
    try {
      await this.prisma.accessorial.delete({ where: { id } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
        throw new ConflictException('Accessorial is still referenced by rates or loads');
      }
      throw e;
    }
    return { deleted: true };
  }
}
