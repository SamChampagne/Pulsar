import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { paginated, paginationArgs } from '../../../common/pagination';
import { OwnershipService } from '../../../prisma/ownership.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { RoutingService } from '../../../core/routing/routing.service';
import { CreateLocationDto, UpdateLocationDto } from './dto/location.dto';

@Injectable()
export class LocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly routing: RoutingService,
  ) {}

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

  /** Single-line address fed to the geocoder. */
  private geocodeAddress(loc: {
    addressLine1: string;
    city: string;
    state?: string | null;
    postalCode?: string | null;
    country?: string | null;
  }) {
    return this.routing.geocode(
      [loc.addressLine1, loc.city, loc.state, loc.postalCode, loc.country ?? 'CA']
        .filter(Boolean)
        .join(', '),
    );
  }

  async create(tenantId: string, dto: CreateLocationDto) {
    const existing = await this.prisma.location.findUnique({
      where: { tenantId_code: { tenantId, code: dto.code } },
    });
    if (existing) throw new ConflictException(`Location code "${dto.code}" already exists`);
    await this.ownership.assertOwnedIfSet('customer', dto.customerId, tenantId);
    // Manual coordinates always win; geocoding only fills the MISSING field(s), best-effort.
    let coords: { latitude?: number; longitude?: number } | undefined;
    if (dto.latitude == null || dto.longitude == null) {
      const geo = await this.geocodeAddress(dto);
      if (geo) {
        coords = {};
        if (dto.latitude == null) coords.latitude = geo.lat;
        if (dto.longitude == null) coords.longitude = geo.lng;
      }
    }
    return this.prisma.location.create({ data: { ...dto, ...coords, tenantId } });
  }

  async update(tenantId: string, id: string, dto: UpdateLocationDto) {
    const current = await this.get(tenantId, id);
    await this.ownership.assertOwnedIfSet('customer', dto.customerId, tenantId);
    const { code: _code, ...data } = dto;
    const merged = { ...current, ...data };
    // Geocode only the field(s) that would otherwise stay empty — existing
    // (possibly manual) coordinates are never overwritten.
    if (merged.latitude == null || merged.longitude == null) {
      const geo = await this.geocodeAddress(merged);
      if (geo) {
        if (merged.latitude == null) Object.assign(data, { latitude: geo.lat });
        if (merged.longitude == null) Object.assign(data, { longitude: geo.lng });
      }
    }
    return this.prisma.location.update({ where: { id }, data });
  }
}
