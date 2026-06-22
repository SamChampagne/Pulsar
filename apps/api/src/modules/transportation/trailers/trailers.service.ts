import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { CustomFieldEntity } from '@pulsar/shared';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { paginated, paginationArgs } from '../../../common/pagination';
import { CustomFieldsService } from '../../../core/custom-fields/custom-fields.service';
import { OwnershipService } from '../../../prisma/ownership.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateTrailerDto, UpdateTrailerDto } from './dto/trailer.dto';

@Injectable()
export class TrailersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly customFields: CustomFieldsService,
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
    const customData = await this.customFields.validateValues(
      'fleet', tenantId, CustomFieldEntity.TRAILER, dto.customData, { partial: false },
    );
    const { customData: _cd, ...dtoWithout } = dto;
    return this.prisma.trailer.create({
      data: {
        ...dtoWithout,
        tenantId,
        ...(customData !== undefined ? { customData: customData as Prisma.InputJsonValue } : {}),
      },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateTrailerDto) {
    await this.get(tenantId, id);
    await this.ownership.assertOwnedIfSet('carrier', dto.carrierId, tenantId);
    const customData = await this.customFields.validateValues(
      'fleet', tenantId, CustomFieldEntity.TRAILER, dto.customData, { partial: true },
    );
    const { unitNumber: _unit, customData: _cd, ...data } = dto;
    return this.prisma.trailer.update({
      where: { id },
      data: {
        ...data,
        ...(customData !== undefined ? { customData: customData as Prisma.InputJsonValue } : {}),
      },
    });
  }
}
