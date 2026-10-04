import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import {
  AuditAction,
  buildDeliveryPlan,
  canTransitionStop,
  deliveryCoverageError,
  DistanceSource,
  LoadStatus,
  StopStatus,
  suggestDeliveryOrder,
  TrackingEventType,
  validateWindowPair,
  type DeliveryLeg,
  type DeliveryPlan,
} from '@pulsar/shared';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { haversineKm, type LatLng } from '../../../core/routing/haversine';
import { RoutingService } from '../../../core/routing/routing.service';
import { OwnershipService } from '../../../prisma/ownership.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { LoadCostService } from '../loads/load-cost.service';
import { DeliveryFuelService } from '../delivery-fuel/delivery-fuel.service';
import { CreateRouteDto } from './dto/route.dto';

const routeInclude = {
  load: { select: { id: true, loadNumber: true, status: true, updatedAt: true } },
  stops: {
    orderBy: { sequence: 'asc' as const },
    include: {
      location: {
        select: { id: true, code: true, name: true, city: true, latitude: true, longitude: true },
      },
    },
  },
};
const editable = [LoadStatus.OPEN, LoadStatus.PLANNED] as string[];

@Injectable()
export class RoutesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly cost: LoadCostService,
    private readonly routing: RoutingService,
    private readonly audit: AuditLogsService,
    @Optional() private readonly fuel?: DeliveryFuelService,
  ) {}

  list(tenantId: string, _query: ListQueryDto) {
    return this.prisma.route.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: routeInclude,
      take: 100,
    });
  }
  async get(tenantId: string, id: string) {
    const route = await this.prisma.route.findFirst({
      where: { id, tenantId },
      include: routeInclude,
    });
    if (!route) throw new NotFoundException('Route not found');
    const shipments = await this.prisma.shipment.findMany({
      where: { tenantId, loadId: route.loadId },
      select: { id: true, originLocationId: true, destinationLocationId: true },
    });
    return { ...route, coverageWarning: this.coverageError(route.stops, shipments) };
  }

  private coverageError(
    stops: { sequence: number; type: string; locationId: string; shipmentId?: string | null }[],
    shipments: { id: string; originLocationId: string; destinationLocationId: string }[],
  ) {
    return deliveryCoverageError(stops, shipments);
  }

  private async prepare(tenantId: string, dto: CreateRouteDto) {
    const load = await this.prisma.load.findFirst({
      where: { id: dto.loadId, tenantId },
      include: {
        route: true,
        shipments: {
          where: { tenantId },
          select: { id: true, originLocationId: true, destinationLocationId: true },
        },
      },
    });
    if (!load) throw new NotFoundException('Load not found');
    if (!editable.includes(load.status))
      throw new BadRequestException('La tournée se prépare seulement avant le dispatch.');
    if (
      dto.expectedUpdatedAt &&
      load.updatedAt.toISOString() !== new Date(dto.expectedUpdatedAt).toISOString()
    )
      throw new ConflictException('Le chargement a changé. Rechargez avant de planifier.');
    if ((dto.planning || load.route?.deliveryPlan) && !dto.expectedUpdatedAt)
      throw new BadRequestException(
        'La version du chargement est obligatoire pour le plan de livraison.',
      );
    const ordered = dto.stops.slice().sort((a, b) => a.sequence - b.sequence);
    if (new Set(ordered.map((s) => s.sequence)).size !== ordered.length)
      throw new BadRequestException('Stop sequences must be unique');
    await Promise.all(
      ordered.flatMap((s) => [
        this.ownership.assertOwned('location', s.locationId, tenantId),
        this.ownership.assertOwnedIfSet('shipment', s.shipmentId, tenantId),
      ]),
    );
    for (const s of ordered) {
      const error = validateWindowPair({
        early: s.plannedArrivalEarly ? new Date(s.plannedArrivalEarly) : null,
        late: s.plannedArrivalLate ? new Date(s.plannedArrivalLate) : null,
      });
      if (error) throw new BadRequestException(`Stop ${s.sequence}: ${error}`);
    }
    // Legacy fully-unlinked itineraries remain readable/buildable, but not optimizable.
    if (dto.planning || load.route?.deliveryPlan || ordered.some((s) => s.shipmentId)) {
      const error = this.coverageError(ordered, load.shipments);
      if (error) throw new BadRequestException(error);
    }
    const locations = await this.prisma.location.findMany({
      where: { tenantId, id: { in: [...new Set(ordered.map((s) => s.locationId))] } },
      select: { id: true, latitude: true, longitude: true, name: true, city: true },
    });
    const byId = new Map(locations.map((l) => [l.id, l]));
    const pointFor = (id: string): LatLng | null => {
      const l = byId.get(id);
      return l?.latitude != null &&
        l.longitude != null &&
        Number.isFinite(l.latitude) &&
        Number.isFinite(l.longitude) &&
        Math.abs(l.latitude) <= 90 &&
        Math.abs(l.longitude) <= 180
        ? { lat: l.latitude, lng: l.longitude }
        : null;
    };
    let options = dto.planning ?? (load.route?.deliveryPlan as DeliveryPlan | null)?.options ?? {};
    let fuelSource: DeliveryPlan['fuelSource'];
    if (dto.fuelSource) {
      if (!dto.planning || !this.fuel)
        throw new BadRequestException(
          'Les hypothèses de départ sont requises avec un profil carburant.',
        );
      const captured = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM loads WHERE id = ${load.id} AND "tenantId" = ${tenantId} FOR UPDATE`;
        const current = await tx.load.findFirst({ where: { tenantId, id: load.id } });
        if (!current || current.updatedAt.getTime() !== load.updatedAt.getTime())
          throw new ConflictException('La tournée a changé.');
        return this.fuel!.resolvePlanningInputsTx(
          tx,
          tenantId,
          current.vehicleId,
          dto.fuelSource!,
          options.startAt,
        );
      });
      options = { ...options, ...captured.options };
      fuelSource = captured.source;
    }
    let stops = ordered,
      optimization = 'Ordre saisi conservé.';
    let savedDistanceKm: number | null = null;
    if (dto.optimize) {
      if (ordered.some((s) => !s.shipmentId))
        throw new BadRequestException(
          'Reliez tous les arrêts aux expéditions avant de proposer un ordre.',
        );
      if (ordered.length > 50)
        throw new BadRequestException('La comparaison est limitée à 50 arrêts.');
      if (ordered.some((s) => s.plannedArrivalLate) && !options.startAt)
        throw new BadRequestException('Indiquez le début pour comparer les fenêtres de livraison.');
      const points = ordered.map((s) => pointFor(s.locationId));
      const matrix = points.every((p): p is LatLng => p != null)
        ? await this.routing.table(points)
        : null;
      if (!matrix)
        optimization =
          'Comparaison indisponible : coordonnées incomplètes ou matrice routière inaccessible. Aucun ordre modifié.';
      else {
        const order = suggestDeliveryOrder(ordered, matrix, options);
        stops = order.map((i, index) => ({ ...ordered[i], sequence: index + 1 }));
        const distance = (indices: number[]) => {
          const pairs = indices.slice(1).map((n, i) => [indices[i], n]);
          if (options.returnToStart) pairs.push([indices[indices.length - 1], indices[0]]);
          return pairs.some(([a, b]) => matrix.distancesKm[a][b] == null)
            ? null
            : pairs.reduce((n, [a, b]) => n + matrix.distancesKm[a][b]!, 0);
        };
        const before = distance(ordered.map((_, i) => i)),
          after = distance(order);
        savedDistanceKm =
          before == null || after == null ? null : Math.round((before - after) * 10) / 10;
        optimization = order.some((n, i) => n !== i)
          ? 'Proposition routière : retards prévisionnels prioritaires, puis kilomètres. Premier arrêt fixé; optimalité globale non garantie.'
          : 'Aucun ordre meilleur trouvé par la recherche locale. Ordre actuel conservé.';
      }
    }
    stops = stops.map((s, i) => ({ ...s, sequence: i + 1 }));
    const points = stops.map((s) => pointFor(s.locationId));
    if (options.returnToStart) points.push(points[0]);
    const road = points.every((p): p is LatLng => p != null)
      ? await this.routing.route(points)
      : null;
    const legs: DeliveryLeg[] = points.slice(1).map((p, i) => {
      const leg = road?.legs?.[i];
      if (leg) return { ...leg, source: 'OSRM' };
      // Older OSRM doubles may expose the total only, usable only for a single leg.
      if (road && points.length === 2)
        return { distanceKm: road.distanceKm, durationMin: road.durationMin, source: 'OSRM' };
      const previous = points[i];
      return p && previous
        ? { distanceKm: haversineKm(previous, p), durationMin: null, source: 'HAVERSINE' }
        : { distanceKm: null, durationMin: null, source: 'UNKNOWN' };
    });
    const deliveryPlan: DeliveryPlan = buildDeliveryPlan(stops, legs, options);
    if (fuelSource) deliveryPlan.fuelSource = fuelSource;
    const manual =
      dto.totalDistanceKm ??
      (load.route?.distanceSource === DistanceSource.MANUAL ? load.route.totalDistanceKm : null);
    if (manual != null)
      deliveryPlan.warnings.push(
        'La distance manuelle de tarification est conservée. Le carburant utilise les trajets détaillés, pas cette valeur globale.',
      );
    deliveryPlan.warnings.push(
      'Prévision hors trafic réel, restrictions poids/hauteur, pauses réglementaires et approche avant le premier arrêt. Vérifiez le trajet camion.',
    );
    return {
      load,
      stops,
      deliveryPlan,
      geometry: road?.geometry ?? null,
      totalDistanceKm: manual ?? road?.distanceKm ?? deliveryPlan.totals.distanceKm,
      estimatedDurationMin: dto.estimatedDurationMin ?? (road ? road.durationMin : null),
      distanceSource:
        manual != null
          ? DistanceSource.MANUAL
          : road
            ? DistanceSource.OSRM
            : deliveryPlan.totals.distanceKm != null
              ? DistanceSource.HAVERSINE
              : null,
      optimization,
      savedDistanceKm,
      labels: Object.fromEntries(locations.map((l) => [l.id, `${l.name}, ${l.city}`])),
      locations,
    };
  }

  async preview(tenantId: string, dto: CreateRouteDto) {
    const { load, ...view } = await this.prepare(tenantId, dto);
    return { ...view, expectedUpdatedAt: load.updatedAt.toISOString() };
  }

  async createForLoad(tenantId: string, dto: CreateRouteDto, userId?: string) {
    if (dto.optimize)
      throw new BadRequestException(
        'Prévisualisez et confirmez l’ordre proposé avant de sauvegarder.',
      );
    const prepared = await this.prepare(tenantId, dto);
    const {
      load,
      stops,
      deliveryPlan,
      totalDistanceKm,
      estimatedDurationMin,
      distanceSource,
      geometry,
    } = prepared;
    const route = await this.prisma.$transaction(async (tx) => {
      // Row lock shared with status/resource/assignment writers. All route replacement is atomic.
      const claimed = await tx.load.updateMany({
        where: { id: load.id, tenantId, status: load.status, updatedAt: load.updatedAt },
        data: { updatedAt: new Date(Math.max(Date.now(), load.updatedAt.getTime() + 1)) },
      });
      if (!claimed.count)
        throw new ConflictException('Le chargement a changé. Rechargez la tournée.');
      if (dto.fuelSource) {
        const checked = await this.fuel!.resolvePlanningInputsTx(
          tx,
          tenantId,
          load.vehicleId,
          dto.fuelSource,
          deliveryPlan.options.startAt,
        );
        if (JSON.stringify(checked.source) !== JSON.stringify(deliveryPlan.fuelSource))
          throw new ConflictException(
            'Les hypothèses carburant ont changé. Prévisualisez à nouveau.',
          );
      }
      const shipments = await tx.shipment.findMany({
        where: { tenantId, loadId: load.id },
        select: { id: true, originLocationId: true, destinationLocationId: true },
      });
      if (dto.planning || load.route?.deliveryPlan || stops.some((s) => s.shipmentId)) {
        const error = this.coverageError(stops, shipments);
        if (error) throw new ConflictException(error);
      }
      const current = await tx.route.findFirst({
        where: { tenantId, loadId: load.id },
        include: { stops: true },
      });
      if (
        (current?.updatedAt.toISOString() ?? null) !== (load.route?.updatedAt.toISOString() ?? null)
      )
        throw new ConflictException('La tournée a changé. Rechargez.');
      if (current?.stops.some((s) => s.status !== StopStatus.PENDING))
        throw new ConflictException('Une tournée déjà exécutée ne peut pas être reconstruite.');
      if (current) await tx.stop.deleteMany({ where: { tenantId, routeId: current.id } });
      const data = {
        totalDistanceKm,
        estimatedDurationMin,
        distanceSource,
        geometry: geometry == null ? Prisma.DbNull : (geometry as Prisma.InputJsonValue),
        deliveryPlan:
          dto.planning || load.route?.deliveryPlan
            ? (deliveryPlan as unknown as Prisma.InputJsonValue)
            : Prisma.DbNull,
        stops: {
          create: stops.map((s) => ({
            tenantId,
            sequence: s.sequence,
            type: s.type,
            locationId: s.locationId,
            shipmentId: s.shipmentId,
            plannedArrivalEarly: s.plannedArrivalEarly
              ? new Date(s.plannedArrivalEarly)
              : undefined,
            plannedArrivalLate: s.plannedArrivalLate ? new Date(s.plannedArrivalLate) : undefined,
            plannedDepartureAt: s.plannedDepartureAt ? new Date(s.plannedDepartureAt) : undefined,
          })),
        },
      };
      const result = current
        ? await tx.route.update({
            where: { id: current.id, tenantId },
            data,
            include: routeInclude,
          })
        : await tx.route.create({
            data: { tenantId, loadId: load.id, ...data },
            include: routeInclude,
          });
      await this.audit.log(
        {
          tenantId,
          userId,
          action: AuditAction.UPDATE,
          entityType: 'route',
          entityId: result.id,
          after: {
            loadId: load.id,
            stopCount: stops.length,
            distanceSource,
            deliveryPlanVersion: 1,
          },
        },
        tx,
      );
      return result;
    });
    await this.cost.recompute(tenantId, dto.loadId);
    return route;
  }

  async updateStopStatus(
    tenantId: string,
    stopId: string,
    status: StopStatus,
    userId?: string,
    authorizeTx?: (tx: Prisma.TransactionClient) => Promise<void>,
  ) {
    const initial = await this.prisma.stop.findFirst({
      where: { id: stopId, tenantId },
      include: { route: true },
    });
    if (!initial) throw new NotFoundException('Stop not found');
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM loads WHERE id = ${initial.route.loadId} AND "tenantId" = ${tenantId} FOR UPDATE`;
      // Capability callers revalidate their access under the same lock as execution.
      await authorizeTx?.(tx);
      const load = await tx.load.findFirst({ where: { id: initial.route.loadId, tenantId } });
      if (
        !load ||
        ![LoadStatus.DISPATCHED, LoadStatus.IN_TRANSIT].includes(load.status as LoadStatus)
      )
        throw new BadRequestException('Le chargement doit être dispatché ou en transit.');
      const stop = await tx.stop.findFirst({
        where: { id: stopId, tenantId },
        include: { route: { include: { stops: { orderBy: { sequence: 'asc' } } } } },
      });
      if (!stop) throw new ConflictException('La tournée a changé.');
      if (stop.status === status) return tx.stop.findFirst({ where: { id: stopId, tenantId } }); // replay: no new timestamp/event
      if (!canTransitionStop(stop.status as StopStatus, status))
        throw new BadRequestException('Transition d’arrêt invalide.');
      if (
        status === StopStatus.ARRIVED &&
        stop.route.stops.some(
          (s) =>
            s.sequence < stop.sequence &&
            (s.status === StopStatus.PENDING || s.status === StopStatus.ARRIVED),
        )
      )
        throw new BadRequestException('Terminez les arrêts précédents avant celui-ci.');
      if (
        status === StopStatus.ARRIVED &&
        stop.type === 'DELIVERY' &&
        stop.shipmentId &&
        !stop.route.stops.some(
          (s) =>
            s.shipmentId === stop.shipmentId &&
            s.type === 'PICKUP' &&
            (s.status === StopStatus.DEPARTED || s.status === StopStatus.COMPLETED),
        )
      )
        throw new BadRequestException('Le ramassage de cette expédition doit être terminé.');
      const now = new Date();
      const changed = await tx.stop.updateMany({
        where: { id: stopId, tenantId, status: stop.status },
        data: {
          status,
          ...(status === StopStatus.ARRIVED ? { actualArrivalAt: now } : {}),
          ...((status === StopStatus.DEPARTED || status === StopStatus.COMPLETED) &&
          !stop.actualDepartureAt
            ? { actualDepartureAt: now }
            : {}),
        },
      });
      if (!changed.count) throw new ConflictException('Cet arrêt a changé.');
      if (status === StopStatus.ARRIVED || status === StopStatus.DEPARTED)
        await tx.trackingEvent.create({
          data: {
            tenantId,
            type:
              status === StopStatus.ARRIVED
                ? TrackingEventType.ARRIVED_AT_STOP
                : TrackingEventType.DEPARTED_STOP,
            loadId: load.id,
            stopId,
            shipmentId: stop.shipmentId,
            recordedById: userId,
          },
        });
      await this.audit.log(
        {
          tenantId,
          userId,
          action: AuditAction.UPDATE,
          entityType: 'stop',
          entityId: stopId,
          before: { status: stop.status },
          after: { status, source: userId ? 'staff' : 'driver-link' },
        },
        tx,
      );
      return tx.stop.findFirst({ where: { id: stopId, tenantId } });
    });
  }
}
