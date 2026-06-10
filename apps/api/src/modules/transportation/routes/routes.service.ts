import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { LoadStatus, StopStatus, TrackingEventType } from '@pulsar/shared';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateRouteDto } from './dto/route.dto';

const routeInclude = {
  load: { select: { id: true, loadNumber: true, status: true } },
  stops: {
    orderBy: { sequence: 'asc' as const },
    include: { location: { select: { id: true, code: true, name: true, city: true } } },
  },
};

@Injectable()
export class RoutesService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string, _query: ListQueryDto) {
    return this.prisma.route.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: routeInclude,
      take: 100,
    });
  }

  async get(tenantId: string, id: string) {
    const route = await this.prisma.route.findFirst({ where: { id, tenantId }, include: routeInclude });
    if (!route) throw new NotFoundException('Route not found');
    return route;
  }

  /** Builds (or rebuilds) the stop sequence of a load before dispatch. */
  async createForLoad(tenantId: string, dto: CreateRouteDto) {
    const load = await this.prisma.load.findFirst({ where: { id: dto.loadId, tenantId } });
    if (!load) throw new NotFoundException('Load not found');
    if (load.status !== LoadStatus.OPEN && load.status !== LoadStatus.PLANNED) {
      throw new BadRequestException('Routes can only be built for OPEN or PLANNED loads');
    }

    const sequences = dto.stops.map((s) => s.sequence);
    if (new Set(sequences).size !== sequences.length) {
      throw new BadRequestException('Stop sequences must be unique');
    }

    // Rebuild from scratch — the route is fully owned by its load.
    await this.prisma.route.deleteMany({ where: { loadId: dto.loadId, tenantId } });
    return this.prisma.route.create({
      data: {
        tenantId,
        loadId: dto.loadId,
        totalDistanceKm: dto.totalDistanceKm,
        estimatedDurationMin: dto.estimatedDurationMin,
        stops: {
          create: dto.stops.map((s) => ({
            tenantId,
            sequence: s.sequence,
            type: s.type,
            locationId: s.locationId,
            shipmentId: s.shipmentId,
            plannedArrivalAt: s.plannedArrivalAt ? new Date(s.plannedArrivalAt) : undefined,
            plannedDepartureAt: s.plannedDepartureAt ? new Date(s.plannedDepartureAt) : undefined,
          })),
        },
      },
      include: routeInclude,
    });
  }

  /** Records arrival/departure at a stop and emits the matching tracking event. */
  async updateStopStatus(
    tenantId: string,
    stopId: string,
    status: StopStatus,
    userId: string,
  ) {
    const stop = await this.prisma.stop.findFirst({
      where: { id: stopId, tenantId },
      include: { route: true },
    });
    if (!stop) throw new NotFoundException('Stop not found');

    const now = new Date();
    const timestamps =
      status === StopStatus.ARRIVED
        ? { actualArrivalAt: now }
        : status === StopStatus.DEPARTED || status === StopStatus.COMPLETED
          ? { actualDepartureAt: now }
          : {};

    const updated = await this.prisma.stop.update({
      where: { id: stopId },
      data: { status, ...timestamps },
    });

    const eventType =
      status === StopStatus.ARRIVED
        ? TrackingEventType.ARRIVED_AT_STOP
        : TrackingEventType.DEPARTED_STOP;
    if (status === StopStatus.ARRIVED || status === StopStatus.DEPARTED) {
      await this.prisma.trackingEvent.create({
        data: {
          tenantId,
          type: eventType,
          loadId: stop.route.loadId,
          stopId: stop.id,
          shipmentId: stop.shipmentId,
          recordedById: userId,
        },
      });
    }
    return updated;
  }
}
