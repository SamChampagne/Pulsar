import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { paginated, paginationArgs } from '../../../common/pagination';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateLocationDto, UpdateLocationDto } from './dto/location.dto';

@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, query: ListQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where: Prisma.LocationWhereInput = {
      tenantId,
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { code: { contains: query.search, mode: 'insensitive' } },
              { city: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.location.findMany({ where, skip, take, orderBy: { name: 'asc' } }),
      this.prisma.location.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  async get(tenantId: string, id: string) {
    const location = await this.prisma.location.findFirst({ where: { id, tenantId } });
    if (!location) throw new NotFoundException('Location not found');
    return location;
  }

  async create(tenantId: string, dto: CreateLocationDto) {
    const existing = await this.prisma.location.findUnique({
      where: { tenantId_code: { tenantId, code: dto.code } },
    });
    if (existing) throw new ConflictException(`Location code "${dto.code}" already exists`);
    return this.prisma.location.create({ data: { tenantId, ...dto } });
  }

  async update(tenantId: string, id: string, dto: UpdateLocationDto) {
    await this.get(tenantId, id);
    const { code: _code, ...data } = dto;
    return this.prisma.location.update({ where: { id }, data });
  }
}
