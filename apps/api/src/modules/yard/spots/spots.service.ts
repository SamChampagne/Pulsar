import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { YardSpotType } from '@pulsar/shared';
import { OwnershipService } from '../../../prisma/ownership.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateSpotDto, SpotListQueryDto, UpdateSpotDto } from './dto/spot.dto';

/**
 * Yard spots master-data (dock doors / parking / staging). A spot belongs to a
 * tenant Location; uniqueness is per (tenant, location, code). Tenant-scoped
 * (rule 1); P2002 surfaces as a 409.
 */
@Injectable()
export class SpotsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
  ) {}

  async list(tenantId: string, query: SpotListQueryDto) {
    return this.prisma.yardSpot.findMany({
      where: {
        tenantId,
        ...(query.locationId ? { locationId: query.locationId } : {}),
        ...(query.type ? { type: query.type as YardSpotType } : {}),
      },
      orderBy: { code: 'asc' },
      take: 200,
      include: { location: { select: { id: true, code: true, name: true } } },
    });
  }

  async get(tenantId: string, id: string) {
    const spot = await this.prisma.yardSpot.findFirst({
      where: { id, tenantId },
      include: { location: { select: { id: true, code: true, name: true } } },
    });
    if (!spot) throw new NotFoundException('Spot not found');
    return spot;
  }

  private async assertTenantLocation(tenantId: string, locationId: string) {
    const loc = await this.prisma.location.findFirst({
      where: { id: locationId, tenantId },
      select: { id: true },
    });
    if (!loc) throw new NotFoundException('Location not found');
  }

  async create(tenantId: string, dto: CreateSpotDto) {
    await this.assertTenantLocation(tenantId, dto.locationId);
    try {
      return await this.prisma.yardSpot.create({ data: { ...dto, tenantId } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Spot code already exists at this location');
      }
      throw err;
    }
  }

  async update(tenantId: string, id: string, dto: UpdateSpotDto) {
    await this.get(tenantId, id);
    if (dto.locationId) await this.assertTenantLocation(tenantId, dto.locationId);
    try {
      await this.prisma.yardSpot.updateMany({ where: { id, tenantId }, data: dto });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Spot code already exists at this location');
      }
      throw err;
    }
    return this.get(tenantId, id);
  }

  /**
   * Bulk-save display-only plan coordinates (posX/posY). Tenant-scoped via
   * updateMany (rule 1) — ids outside the tenant simply match nothing.
   * posX/posY are display-only and never feed occupancy/assignment logic.
   */
  async updateLayout(
    tenantId: string,
    _userId: string,
    positions: { id: string; posX: number; posY: number }[],
  ) {
    await this.prisma.$transaction(
      positions.map((p) =>
        this.prisma.yardSpot.updateMany({
          where: { id: p.id, tenantId },
          data: { posX: p.posX, posY: p.posY },
        }),
      ),
    );
    return { updated: positions.length };
  }
}
