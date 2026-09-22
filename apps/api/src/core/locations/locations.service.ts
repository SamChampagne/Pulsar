import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isValidPostalCode, regionsFor, COUNTRIES } from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { paginated, paginationArgs } from '../../common/pagination';
import { OwnershipService } from '../../prisma/ownership.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RoutingService } from '../routing/routing.service';
import { CreateLocationDto, LocationsListQueryDto, UpdateLocationDto } from './dto/location.dto';

@Injectable()
export class LocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly routing: RoutingService,
  ) {}

  async list(tenantId: string, query: LocationsListQueryDto) {
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
      ...(query.type ? { type: query.type } : {}),
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
    this.validateAddress(dto);
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
    if (dto.country !== undefined || dto.postalCode !== undefined || dto.state !== undefined)
      this.validateAddress(merged);
    // Geocode only the field(s) that would otherwise stay empty — existing
    // (possibly manual) coordinates are never overwritten.
    if (merged.latitude == null || merged.longitude == null) {
      const geo = await this.geocodeAddress(merged);
      if (geo) {
        if (merged.latitude == null) Object.assign(data, { latitude: geo.lat });
        if (merged.longitude == null) Object.assign(data, { longitude: geo.lng });
      }
    }
    const res = await this.prisma.location.updateMany({ where: { id, tenantId }, data });
    if (res.count === 0) throw new NotFoundException('Location not found');
    return this.prisma.location.findFirstOrThrow({ where: { id, tenantId } });
  }

  private validateAddress(address: {
    country?: string | null;
    state?: string | null;
    postalCode?: string | null;
  }) {
    if (address.country && !COUNTRIES.some((country) => country.code === address.country))
      throw new BadRequestException('Choisissez un pays du référentiel.');
    if (!isValidPostalCode(address.postalCode ?? '', address.country))
      throw new BadRequestException(
        'Code postal invalide pour ce pays (Canada : H1A 1A1 ; États-Unis : 12345 ou 12345-6789).',
      );
    const regions = regionsFor(address.country ?? '');
    if (
      address.state &&
      regions.length &&
      !regions.some(
        (region) =>
          region.code === address.state ||
          region.name.toLowerCase() === address.state?.toLowerCase(),
      )
    )
      throw new BadRequestException('Choisissez une province ou un État du pays sélectionné.');
  }
}
