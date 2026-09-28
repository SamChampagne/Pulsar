import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { CustomFieldEntity } from '@pulsar/shared';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { paginated, paginationArgs } from '../../../common/pagination';
import { CustomFieldsService } from '../../../core/custom-fields/custom-fields.service';
import { OwnershipService } from '../../../prisma/ownership.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateVehicleDto, UpdateVehicleDto } from './dto/vehicle.dto';

@Injectable()
export class VehiclesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly customFields: CustomFieldsService,
  ) {}

  async list(tenantId: string, query: ListQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where: Prisma.VehicleWhereInput = {
      tenantId,
      ...(query.search
        ? { unitNumber: { contains: query.search, mode: 'insensitive' } }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.vehicle.findMany({
        where,
        skip,
        take,
        orderBy: { unitNumber: 'asc' },
        include: { carrier: { select: { id: true, code: true, name: true } } },
      }),
      this.prisma.vehicle.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  async get(tenantId: string, id: string) {
    const vehicle = await this.prisma.vehicle.findFirst({ where: { id, tenantId } });
    if (!vehicle) throw new NotFoundException('Vehicle not found');
    return vehicle;
  }

  async create(tenantId: string, dto: CreateVehicleDto) {
    const existing = await this.prisma.vehicle.findUnique({
      where: { tenantId_unitNumber: { tenantId, unitNumber: dto.unitNumber } },
    });
    if (existing) throw new ConflictException(`Vehicle "${dto.unitNumber}" already exists`);
    await this.ownership.assertOwnedIfSet('carrier', dto.carrierId, tenantId);
    const customData = await this.customFields.validateValues(
      'fleet', tenantId, CustomFieldEntity.VEHICLE, dto.customData, { partial: false },
    );
    const { customData: _cd, ...dtoWithout } = dto;
    return this.prisma.vehicle.create({
      data: {
        ...dtoWithout,
        tenantId,
        ...(customData !== undefined ? { customData: customData as Prisma.InputJsonValue } : {}),
      },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateVehicleDto) {
    await this.get(tenantId, id);
    await this.ownership.assertOwnedIfSet('carrier', dto.carrierId, tenantId);
    const customData = await this.customFields.validateValues(
      'fleet', tenantId, CustomFieldEntity.VEHICLE, dto.customData, { partial: true },
    );
    const { unitNumber: _unit, customData: _cd, ...data } = dto;
    return this.prisma.vehicle.update({
      where: { id, tenantId },
      data: {
        ...data,
        ...(customData !== undefined ? { customData: customData as Prisma.InputJsonValue } : {}),
      },
    });
  }
}
