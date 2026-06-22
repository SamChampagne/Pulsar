import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { paginated, paginationArgs } from '../../../common/pagination';
import { OwnershipService } from '../../../prisma/ownership.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateDriverDto, UpdateDriverDto } from './dto/driver.dto';

@Injectable()
export class DriversService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
  ) {}

  async list(tenantId: string, query: ListQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where: Prisma.DriverWhereInput = {
      tenantId,
      ...(query.search
        ? {
            OR: [
              { firstName: { contains: query.search, mode: 'insensitive' } },
              { lastName: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.driver.findMany({
        where,
        skip,
        take,
        orderBy: { lastName: 'asc' },
        include: { carrier: { select: { id: true, code: true, name: true } } },
      }),
      this.prisma.driver.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  async get(tenantId: string, id: string) {
    const driver = await this.prisma.driver.findFirst({
      where: { id, tenantId },
      include: { carrier: true },
    });
    if (!driver) throw new NotFoundException('Driver not found');
    return driver;
  }

  async create(tenantId: string, dto: CreateDriverDto) {
    await this.ownership.assertOwnedIfSet('carrier', dto.carrierId, tenantId);
    return this.prisma.driver.create({ data: { ...dto, tenantId } });
  }

  async update(tenantId: string, id: string, dto: UpdateDriverDto) {
    await this.get(tenantId, id);
    await this.ownership.assertOwnedIfSet('carrier', dto.carrierId, tenantId);
    const res = await this.prisma.driver.updateMany({ where: { id, tenantId }, data: dto });
    if (res.count === 0) throw new NotFoundException('Driver not found');
    return this.prisma.driver.findFirstOrThrow({ where: { id, tenantId } });
  }
}
