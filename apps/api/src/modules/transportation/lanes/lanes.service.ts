import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LaneEndpointType, buildEndpointKey, compareLanes, candidateEndpointKeys } from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { paginated, paginationArgs } from '../../../common/pagination';
import { OwnershipService } from '../../../prisma/ownership.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { resolveLoadEndpoints } from '../rating/load-endpoints';
import { CreateLaneDto, LaneEndpointDto, UpdateLaneDto } from './dto/lane.dto';

const laneInclude = {
  originLocation: { select: { id: true, code: true, name: true, city: true } },
  destinationLocation: { select: { id: true, code: true, name: true, city: true } },
  carrierPreferences: {
    orderBy: { rank: 'asc' as const },
    include: { carrier: { select: { id: true, code: true, name: true, email: true } } },
  },
} satisfies Prisma.LaneInclude;

interface EndpointColumns {
  locationId: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  key: string;
}

@Injectable()
export class LanesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
  ) {}

  /** Validates one endpoint per its level and produces the column values + normalized key. */
  private async buildEndpoint(
    tenantId: string,
    type: LaneEndpointType,
    input: LaneEndpointDto,
  ): Promise<EndpointColumns> {
    if (type === LaneEndpointType.LOCATION) {
      if (!input.locationId) {
        throw new BadRequestException('locationId is required for a LOCATION endpoint');
      }
      await this.ownership.assertOwned('location', input.locationId, tenantId);
    }
    let key: string;
    try {
      key = buildEndpointKey(type, input);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const isCity = type === LaneEndpointType.CITY;
    const hasState = isCity || type === LaneEndpointType.STATE;
    return {
      locationId: type === LaneEndpointType.LOCATION ? input.locationId! : null,
      city: isCity ? input.city! : null,
      state: hasState ? input.state! : null,
      country: type === LaneEndpointType.LOCATION ? null : input.country!,
      key,
    };
  }

  async list(tenantId: string, query: ListQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where: Prisma.LaneWhereInput = {
      tenantId,
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.lane.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: laneInclude,
      }),
      this.prisma.lane.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  async get(tenantId: string, id: string) {
    const lane = await this.prisma.lane.findFirst({ where: { id, tenantId }, include: laneInclude });
    if (!lane) throw new NotFoundException('Lane not found');
    return lane;
  }

  async create(tenantId: string, dto: CreateLaneDto) {
    const origin = await this.buildEndpoint(tenantId, dto.originType, dto.origin);
    const destination = await this.buildEndpoint(tenantId, dto.destinationType, dto.destination);
    try {
      return await this.prisma.lane.create({
        data: {
          tenantId,
          name: dto.name,
          originType: dto.originType,
          originLocationId: origin.locationId,
          originCity: origin.city,
          originState: origin.state,
          originCountry: origin.country,
          destinationType: dto.destinationType,
          destinationLocationId: destination.locationId,
          destinationCity: destination.city,
          destinationState: destination.state,
          destinationCountry: destination.country,
          originKey: origin.key,
          destinationKey: destination.key,
        },
        include: laneInclude,
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('An identical lane already exists');
      }
      throw e;
    }
  }

  async update(tenantId: string, id: string, dto: UpdateLaneDto) {
    await this.get(tenantId, id);
    return this.prisma.lane.update({ where: { id }, data: { name: dto.name }, include: laneInclude });
  }

  /** Restrict policy: refuse deletion while rates or preferences reference the lane. */
  async remove(tenantId: string, id: string) {
    await this.get(tenantId, id);
    const [rates, prefs] = await this.prisma.$transaction([
      this.prisma.rate.count({ where: { laneId: id } }),
      this.prisma.laneCarrierPreference.count({ where: { laneId: id } }),
    ]);
    if (rates > 0 || prefs > 0) {
      throw new ConflictException(
        `Lane is referenced by ${rates} rate(s) and ${prefs} carrier preference(s) — remove them first`,
      );
    }
    await this.prisma.lane.delete({ where: { id } });
    return { deleted: true };
  }

  /** Replaces the ordered carrier list of a lane (idempotent PUT semantics). */
  async setCarriers(tenantId: string, laneId: string, carrierIds: string[]) {
    if (new Set(carrierIds).size !== carrierIds.length) {
      throw new BadRequestException('Duplicate carriers in the preference list');
    }
    await this.get(tenantId, laneId);
    await Promise.all(carrierIds.map((id) => this.ownership.assertOwned('carrier', id, tenantId)));

    await this.prisma.$transaction([
      this.prisma.laneCarrierPreference.deleteMany({ where: { tenantId, laneId } }),
      this.prisma.laneCarrierPreference.createMany({
        data: carrierIds.map((carrierId, index) => ({ tenantId, laneId, carrierId, rank: index + 1 })),
      }),
    ]);
    return this.get(tenantId, laneId);
  }

  /** Lanes matching a physical O/D, most specific first (shared compareLanes ordering). */
  async findMatching(
    tenantId: string,
    origin: Parameters<typeof candidateEndpointKeys>[0],
    destination: Parameters<typeof candidateEndpointKeys>[0],
  ) {
    const lanes = await this.prisma.lane.findMany({
      where: {
        tenantId,
        originKey: { in: candidateEndpointKeys(origin) },
        destinationKey: { in: candidateEndpointKeys(destination) },
      },
      include: { carrierPreferences: { orderBy: { rank: 'asc' } } },
    });
    return [...lanes].sort(compareLanes);
  }

  /**
   * Ordered carrier ids for auto-tendering: the most specific matching lane THAT HAS
   * preferences wins (a more specific lane without preferences does not mask a broader one).
   */
  async orderedCarrierIdsForLoad(tenantId: string, loadId: string): Promise<string[]> {
    const endpoints = await resolveLoadEndpoints(this.prisma, tenantId, loadId);
    if (!endpoints) return [];
    const lanes = await this.findMatching(tenantId, endpoints.origin, endpoints.destination);
    const withPrefs = lanes.find((l) => l.carrierPreferences.length > 0);
    return withPrefs ? withPrefs.carrierPreferences.map((p) => p.carrierId) : [];
  }
}
