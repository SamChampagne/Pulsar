import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@pulsar/database';
import {
  AuditAction,
  applyDeliveryFuelParameters,
  compareDeliveryFuel,
  validateDeliveryFuelActual,
  validateDeliveryFuelPrice,
  validateDeliveryFuelProfile,
  validateDeliveryFuelSource,
  type DeliveryFuelActualSnapshot,
  type DeliveryFuelApplied,
  type DeliveryFuelPrice,
  type DeliveryFuelProfile,
  type DeliveryFuelSource,
  type DeliveryFuelSourceInput,
} from '@pulsar/shared';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { SaveFuelActualDto, SaveFuelPriceDto, SaveFuelProfileDto } from './delivery-fuel.dto';

type Tx = Prisma.TransactionClient;
type Row = { id: string; revision: number; createdAt: Date; snapshot: Prisma.JsonValue };
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const view = (row: Row) => ({
  id: row.id,
  revision: row.revision,
  createdAt: row.createdAt.toISOString(),
  snapshot: row.snapshot,
});
const PAGE_SIZE = 20;
const MAX_BASELINE_BYTES = 1024 * 1024;

@Injectable()
export class DeliveryFuelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  /** Shared with route capture. Lock order is load row, THEN fuel tenant advisory lock. */
  private async lock(tx: Tx, tenantId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`delivery-fuel:${tenantId}`}, 0))`;
  }
  private validate<T>(fn: (value: unknown) => T, value: unknown): T {
    try {
      return fn(value);
    } catch (e) {
      throw new BadRequestException(
        e instanceof Error ? e.message : 'Paramètres carburant invalides.',
      );
    }
  }
  private async transaction<T>(run: (tx: Tx) => Promise<T>) {
    try {
      return await this.prisma.$transaction(run, { timeout: 15000 });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (['P2034', 'P2002'].includes(error.code) ||
          (error.code === 'P2010' && String(error.meta?.code) === '40001'))
      )
        throw new ConflictException(
          'Modification concurrente. Inspectez le dossier ou reprenez la même demande.',
        );
      throw error;
    }
  }
  private async vehicle(tx: Tx, tenantId: string, vehicleId: string) {
    const vehicle = await tx.vehicle.findFirst({
      where: { tenantId, id: vehicleId },
      select: { id: true, unitNumber: true },
    });
    if (!vehicle) throw new NotFoundException('Véhicule introuvable.');
    return vehicle;
  }
  private async load(tx: Tx, tenantId: string, loadId: string) {
    const load = await tx.load.findFirst({
      where: { tenantId, id: loadId },
      select: {
        id: true,
        loadNumber: true,
        status: true,
        updatedAt: true,
        vehicleId: true,
        vehicle: { select: { id: true, unitNumber: true } },
      },
    });
    if (!load) throw new NotFoundException('Chargement introuvable.');
    return load;
  }
  private fingerprint(actorId: string, kind: string, scope: string, dto: unknown) {
    // DTO order is normalized by each caller; the exact nested request remains bound to its key.
    return createHash('sha256').update(JSON.stringify({ actorId, kind, scope, dto })).digest('hex');
  }
  private replay(
    row: (Row & { actorId: string; fingerprint: string }) | null,
    actorId: string,
    fingerprint: string,
    operationKey: string,
  ) {
    if (!row) return null;
    if (row.actorId !== actorId || row.fingerprint !== fingerprint)
      throw new ConflictException('Cette clé appartient à une autre demande.');
    return { operationKey, ...view(row) };
  }
  private version(actual: number, expected: number) {
    if (actual !== expected)
      throw new ConflictException(
        'Révision modifiée. Rechargez avant de préparer une nouvelle demande.',
      );
  }
  private page(page: number) {
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000)
      throw new BadRequestException('Page invalide.');
    return { skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE };
  }
  async profiles(tenantId: string, vehicleId: string, page = 1) {
    return this.prisma.$transaction(
      async (tx) => {
        await this.vehicle(tx, tenantId, vehicleId);
        const where = { tenantId, vehicleId };
        const [items, total] = await Promise.all([
          tx.deliveryFuelProfileRevision.findMany({
            where,
            orderBy: { revision: 'desc' },
            ...this.page(page),
          }),
          tx.deliveryFuelProfileRevision.count({ where }),
        ]);
        return { items: items.map(view), total, page, pageSize: PAGE_SIZE };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async prices(tenantId: string, page = 1) {
    return this.prisma.$transaction(
      async (tx) => {
        const [items, total] = await Promise.all([
          tx.deliveryFuelPriceRevision.findMany({
            where: { tenantId },
            orderBy: { revision: 'desc' },
            ...this.page(page),
          }),
          tx.deliveryFuelPriceRevision.count({ where: { tenantId } }),
        ]);
        return { items: items.map(view), total, page, pageSize: PAGE_SIZE };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async actuals(tenantId: string, loadId: string, page = 1) {
    return this.prisma.$transaction(
      async (tx) => {
        await this.load(tx, tenantId, loadId);
        const where = { tenantId, loadId };
        const [items, total] = await Promise.all([
          tx.deliveryFuelActualRevision.findMany({
            where,
            orderBy: { revision: 'desc' },
            ...this.page(page),
          }),
          tx.deliveryFuelActualRevision.count({ where }),
        ]);
        return {
          items: items.map((row) => this.actualView(row)),
          total,
          page,
          pageSize: PAGE_SIZE,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  private actualView(row: Row) {
    const snapshot = row.snapshot as unknown as DeliveryFuelActualSnapshot;
    return {
      ...view(row),
      comparison: compareDeliveryFuel(snapshot, snapshot.baseline.deliveryPlan),
    };
  }
  async context(tenantId: string, loadId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const load = await this.load(tx, tenantId, loadId);
        const route = await tx.route.findFirst({
          where: { tenantId, loadId },
          select: { id: true, updatedAt: true, deliveryPlan: true },
        });
        const profile = load.vehicleId
          ? await tx.deliveryFuelProfileRevision.findFirst({
              where: { tenantId, vehicleId: load.vehicleId },
              orderBy: { revision: 'desc' },
            })
          : null;
        const price = await tx.deliveryFuelPriceRevision.findFirst({
          where: { tenantId },
          orderBy: { revision: 'desc' },
          select: { revision: true },
        });
        const actual = await tx.deliveryFuelActualRevision.findFirst({
          where: { tenantId, loadId },
          orderBy: { revision: 'desc' },
        });
        return {
          load,
          route,
          profile: profile ? view(profile) : null,
          latestPriceRevision: price?.revision ?? 0,
          actual: actual ? this.actualView(actual) : null,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async saveProfile(tenantId: string, actorId: string, vehicleId: string, dto: SaveFuelProfileDto) {
    const profile = this.validate(validateDeliveryFuelProfile, dto.profile);
    const operationKey = dto.operationKey.toLowerCase();
    const fingerprint = this.fingerprint(actorId, 'profile', vehicleId, {
      expectedRevision: dto.expectedRevision,
      profile: dto.profile,
    });
    return this.transaction(async (tx) => {
      await this.lock(tx, tenantId);
      await this.vehicle(tx, tenantId, vehicleId);
      const replay = this.replay(
        await tx.deliveryFuelProfileRevision.findFirst({ where: { tenantId, operationKey } }),
        actorId,
        fingerprint,
        operationKey,
      );
      if (replay) return replay;
      const latest = await tx.deliveryFuelProfileRevision.findFirst({
        where: { tenantId, vehicleId },
        orderBy: { revision: 'desc' },
      });
      this.version(latest?.revision ?? 0, dto.expectedRevision);
      const row = await tx.deliveryFuelProfileRevision.create({
        data: {
          tenantId,
          vehicleId,
          actorId,
          operationKey,
          fingerprint,
          revision: dto.expectedRevision + 1,
          snapshot: json(profile),
        },
      });
      await this.audit.log(
        {
          tenantId,
          userId: actorId,
          action: AuditAction.CREATE,
          entityType: 'delivery_fuel_profile',
          entityId: row.id,
          after: { vehicleId, revision: row.revision, profile },
        },
        tx,
      );
      return { operationKey, ...view(row) };
    });
  }
  async savePrice(tenantId: string, actorId: string, dto: SaveFuelPriceDto) {
    const price = this.validate(validateDeliveryFuelPrice, dto.price);
    const operationKey = dto.operationKey.toLowerCase();
    const fingerprint = this.fingerprint(actorId, 'price', tenantId, {
      expectedRevision: dto.expectedRevision,
      price: dto.price,
    });
    return this.transaction(async (tx) => {
      await this.lock(tx, tenantId);
      const replay = this.replay(
        await tx.deliveryFuelPriceRevision.findFirst({ where: { tenantId, operationKey } }),
        actorId,
        fingerprint,
        operationKey,
      );
      if (replay) return replay;
      const latest = await tx.deliveryFuelPriceRevision.findFirst({
        where: { tenantId },
        orderBy: { revision: 'desc' },
      });
      this.version(latest?.revision ?? 0, dto.expectedRevision);
      const row = await tx.deliveryFuelPriceRevision.create({
        data: {
          tenantId,
          actorId,
          operationKey,
          fingerprint,
          revision: dto.expectedRevision + 1,
          snapshot: json(price),
        },
      });
      await this.audit.log(
        {
          tenantId,
          userId: actorId,
          action: AuditAction.CREATE,
          entityType: 'delivery_fuel_price',
          entityId: row.id,
          after: { revision: row.revision, price },
        },
        tx,
      );
      return { operationKey, ...view(row) };
    });
  }
  async saveActual(tenantId: string, actorId: string, loadId: string, dto: SaveFuelActualDto) {
    const actual = this.validate(validateDeliveryFuelActual, dto.actual);
    const operationKey = dto.operationKey.toLowerCase();
    const fingerprint = this.fingerprint(actorId, 'actual', loadId, {
      expectedRevision: dto.expectedRevision,
      expectedLoadUpdatedAt: dto.expectedLoadUpdatedAt,
      expectedRouteUpdatedAt: dto.expectedRouteUpdatedAt,
      actual: dto.actual,
    });
    return this.transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM loads WHERE id = ${loadId} AND "tenantId" = ${tenantId} FOR UPDATE`;
      await this.lock(tx, tenantId);
      const load = await this.load(tx, tenantId, loadId);
      const replay = this.replay(
        await tx.deliveryFuelActualRevision.findFirst({ where: { tenantId, operationKey } }),
        actorId,
        fingerprint,
        operationKey,
      );
      if (replay) return replay;
      if (!['IN_TRANSIT', 'COMPLETED'].includes(load.status))
        throw new ConflictException('Le réel se déclare sur une tournée en transit ou terminée.');
      if (load.updatedAt.toISOString() !== dto.expectedLoadUpdatedAt)
        throw new ConflictException('Chargement modifié. Rechargez le dossier.');
      if (Date.parse(actual.measuredAt) > Date.now())
        throw new BadRequestException('Le relevé réel ne peut pas être daté dans le futur.');
      const route = await tx.route.findFirst({ where: { tenantId, loadId } });
      if (!route?.deliveryPlan)
        throw new ConflictException(
          'Un plan opérationnel enregistré est requis pour capturer la comparaison.',
        );
      if (route.updatedAt.toISOString() !== dto.expectedRouteUpdatedAt)
        throw new ConflictException('Tournée modifiée. Rechargez le dossier.');
      const latest = await tx.deliveryFuelActualRevision.findFirst({
        where: { tenantId, loadId },
        orderBy: { revision: 'desc' },
      });
      this.version(latest?.revision ?? 0, dto.expectedRevision);
      const baseline = latest
        ? (latest.snapshot as unknown as DeliveryFuelActualSnapshot).baseline
        : {
            routeId: route.id,
            routeUpdatedAt: route.updatedAt.toISOString(),
            deliveryPlan: route.deliveryPlan,
          };
      if (!baseline || Buffer.byteLength(JSON.stringify(baseline), 'utf8') > MAX_BASELINE_BYTES)
        throw new BadRequestException(
          'Base de comparaison absente ou trop volumineuse (maximum 1 Mio).',
        );
      const snapshot: DeliveryFuelActualSnapshot = { ...actual, baseline };
      const row = await tx.deliveryFuelActualRevision.create({
        data: {
          tenantId,
          loadId,
          actorId,
          operationKey,
          fingerprint,
          revision: dto.expectedRevision + 1,
          snapshot: json(snapshot),
        },
      });
      await this.audit.log(
        {
          tenantId,
          userId: actorId,
          action: AuditAction.CREATE,
          entityType: 'delivery_fuel_actual',
          entityId: row.id,
          after: {
            loadId,
            revision: row.revision,
            actual,
            baselineRouteId: baseline.routeId,
            baselineRouteUpdatedAt: baseline.routeUpdatedAt,
          },
        },
        tx,
      );
      return { operationKey, ...this.actualView(row) };
    });
  }
  /** Caller holds the load lock and persists returned source with the route plan atomically. */
  async resolvePlanningInputsTx(
    tx: Tx,
    tenantId: string,
    vehicleId: string | null,
    input: DeliveryFuelSourceInput,
    planningStartAt?: string,
  ): Promise<{ options: DeliveryFuelApplied['options']; source: DeliveryFuelSource }> {
    const source = this.validate(validateDeliveryFuelSource, input);
    if (planningStartAt) {
      if (
        !Number.isFinite(Date.parse(planningStartAt)) ||
        source.asOf !== new Date(planningStartAt).toISOString().slice(0, 10)
      )
        throw new BadRequestException(
          'La date du prix doit correspondre au jour UTC du départ planifié.',
        );
    } else if (source.asOf > new Date().toISOString().slice(0, 10))
      throw new BadRequestException(
        'Une date de référence future exige un départ planifié explicite.',
      );
    await this.lock(tx, tenantId);
    if (!vehicleId || source.vehicleId !== vehicleId)
      throw new ConflictException('Le véhicule affecté a changé. Appliquez son profil courant.');
    await this.vehicle(tx, tenantId, vehicleId);
    const profileRow = await tx.deliveryFuelProfileRevision.findFirst({
      where: { tenantId, vehicleId },
      orderBy: { revision: 'desc' },
    });
    if (!profileRow || profileRow.revision !== source.profileRevision)
      throw new ConflictException('Profil véhicule modifié. Appliquez la révision courante.');
    const priceRow = await tx.deliveryFuelPriceRevision.findFirst({
      where: { tenantId, revision: source.priceRevision },
    });
    if (!priceRow) throw new NotFoundException('Révision de prix introuvable.');
    const profile = this.validate(
      validateDeliveryFuelProfile,
      profileRow.snapshot,
    ) as DeliveryFuelProfile;
    const price = this.validate(validateDeliveryFuelPrice, priceRow.snapshot) as DeliveryFuelPrice;
    if (price.currency !== source.currency)
      throw new BadRequestException(
        'La devise doit correspondre au prix choisi; aucune conversion implicite.',
      );
    if (price.effectiveOn > source.asOf)
      throw new BadRequestException('Ce prix est futur pour la date de référence choisie.');
    return {
      options: applyDeliveryFuelParameters(profile, price),
      source: {
        ...source,
        version: 1,
        profileId: profileRow.id,
        priceId: priceRow.id,
        profile,
        price,
      },
    };
  }
}
