import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { paginated, paginationArgs } from '../../../common/pagination';
import { OwnershipService } from '../../../prisma/ownership.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateTrailerDto, UpdateTrailerDto } from './dto/trailer.dto';

@Injectable()
export class TrailersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
  ) {}

  async list(tenantId: string, query: ListQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where: Prisma.TrailerWhereInput = {
      tenantId,
      ...(query.search
        ? { unitNumber: { contains: query.search, mode: 'insensitive' } }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.trailer.findMany({
        where,
        skip,
        take,
        orderBy: { unitNumber: 'asc' },
        include: { carrier: { select: { id: true, code: true, name: true } } },
      }),
      this.prisma.trailer.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  async get(tenantId: string, id: string) {
    const trailer = await this.prisma.trailer.findFirst({ where: { id, tenantId } });
    if (!trailer) throw new NotFoundException('Trailer not found');
    return trailer;
  }

  async create(tenantId: string, dto: CreateTrailerDto) {
    const existing = await this.prisma.trailer.findUnique({
      where: { tenantId_unitNumber: { tenantId, unitNumber: dto.unitNumber } },
    });
    if (existing) throw new ConflictException(`Trailer "${dto.unitNumber}" already exists`);
    await this.ownership.assertOwnedIfSet('carrier', dto.carrierId, tenantId);
    return this.prisma.trailer.create({ data: { tenantId, ...dto } });
  }

  async update(tenantId: string, id: string, dto: UpdateTrailerDto) {
    await this.get(tenantId, id);
    await this.ownership.assertOwnedIfSet('carrier', dto.carrierId, tenantId);
    const { unitNumber: _unit, ...data } = dto;
    return this.prisma.trailer.update({ where: { id }, data });
  }
}
