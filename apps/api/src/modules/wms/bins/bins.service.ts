import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { OwnershipService } from '../../../prisma/ownership.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { BinListQueryDto, CreateBinDto, UpdateBinDto } from './dto/bin.dto';

@Injectable()
export class BinsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
  ) {}

  async list(tenantId: string, query: BinListQueryDto) {
    return this.prisma.bin.findMany({
      where: {
        tenantId,
        ...(query.locationId ? { locationId: query.locationId } : {}),
        ...(query.search
          ? {
              OR: [
                { code: { contains: query.search, mode: 'insensitive' as const } },
                { zone: { contains: query.search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      orderBy: { code: 'asc' },
      take: 200,
      include: { location: { select: { id: true, code: true, name: true } } },
    });
  }

  async get(tenantId: string, id: string) {
    const bin = await this.prisma.bin.findFirst({
      where: { id, tenantId },
      include: { location: { select: { id: true, code: true, name: true } } },
    });
    if (!bin) throw new NotFoundException('Bin not found');
    return bin;
  }

  private async assertWarehouseLocation(tenantId: string, locationId: string) {
    const loc = await this.prisma.location.findFirst({
      where: { id: locationId, tenantId },
      select: { id: true, type: true },
    });
    if (!loc) throw new NotFoundException('Location not found');
    if (loc.type !== 'WAREHOUSE') {
      throw new BadRequestException('Bins require a WAREHOUSE location');
    }
  }

  async create(tenantId: string, dto: CreateBinDto) {
    await this.ownership.assertOwned('location', dto.locationId, tenantId);
    await this.assertWarehouseLocation(tenantId, dto.locationId);
    try {
      return await this.prisma.bin.create({ data: { ...dto, tenantId } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Bin code already exists in this location');
      }
      throw err;
    }
  }

  async update(tenantId: string, id: string, dto: UpdateBinDto) {
    try {
      await this.prisma.$transaction(async (tx) => {
        // Same mutex as stock posting: a bin cannot be disabled between validation and a movement.
        await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
        const bin = await tx.bin.findFirst({ where: { id, tenantId } });
        if (!bin) throw new NotFoundException('Bin not found');
        if (
          dto.expectedUpdatedAt &&
          bin.updatedAt.toISOString() !== new Date(dto.expectedUpdatedAt).toISOString()
        )
          throw new ConflictException(
            'Cet emplacement a changé. Rechargez-le avant de modifier sa zone.',
          );
        if (dto.locationId && dto.locationId !== bin.locationId)
          throw new BadRequestException(
            'Le site d’un emplacement est immuable. Créez un nouvel emplacement.',
          );
        if (
          (dto.isActive === false || (dto.kind && dto.kind !== bin.kind)) &&
          (await tx.inventoryLevel.count({ where: { tenantId, binId: id, qtyOnHand: { not: 0 } } }))
        )
          throw new ConflictException(
            'Videz le stock avant de désactiver cet emplacement ou changer son type.',
          );
        const { expectedUpdatedAt, ...data } = dto;
        await tx.bin.updateMany({ where: { id, tenantId }, data });
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Bin code already exists in this location');
      }
      throw err;
    }
    return this.get(tenantId, id);
  }
}
