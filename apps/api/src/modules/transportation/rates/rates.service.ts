import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { paginated, paginationArgs } from '../../../common/pagination';
import { OwnershipService } from '../../../prisma/ownership.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateRateDto, UpdateRateDto } from './dto/rate.dto';

@Injectable()
export class RatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
  ) {}

  private async assertReferences(tenantId: string, dto: UpdateRateDto) {
    await Promise.all([
      this.ownership.assertOwnedIfSet('carrier', dto.carrierId, tenantId),
      this.ownership.assertOwnedIfSet('customer', dto.customerId, tenantId),
    ]);
  }

  async list(tenantId: string, query: ListQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where: Prisma.RateWhereInput = {
      tenantId,
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.rate.findMany({
        where,
        skip,
        take,
        orderBy: { name: 'asc' },
        include: {
          carrier: { select: { id: true, code: true, name: true } },
          customer: { select: { id: true, code: true, name: true } },
        },
      }),
      this.prisma.rate.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  async get(tenantId: string, id: string) {
    const rate = await this.prisma.rate.findFirst({
      where: { id, tenantId },
      include: { carrier: true, customer: true },
    });
    if (!rate) throw new NotFoundException('Rate not found');
    return rate;
  }

  async create(tenantId: string, dto: CreateRateDto) {
    await this.assertReferences(tenantId, dto);
    return this.prisma.rate.create({
      data: {
        tenantId,
        ...dto,
        validFrom: dto.validFrom ? new Date(dto.validFrom) : undefined,
        validTo: dto.validTo ? new Date(dto.validTo) : undefined,
      },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateRateDto) {
    await this.get(tenantId, id);
    await this.assertReferences(tenantId, dto);
    return this.prisma.rate.update({
      where: { id },
      data: {
        ...dto,
        validFrom: dto.validFrom ? new Date(dto.validFrom) : undefined,
        validTo: dto.validTo ? new Date(dto.validTo) : undefined,
      },
    });
  }
}
