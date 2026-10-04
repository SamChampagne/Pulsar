import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma, type DeliveryPackage } from '@pulsar/database';
import {
  AuditAction,
  DeliveryPackageStatus,
  ShipmentStatus,
  TrackingEventType,
  canTransitionDeliveryPackage,
  canTransitionShipment,
  normalizeDeliveryPackageLabel,
  validateDeliveryPackageContents,
} from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { SequencesService } from '../../../prisma/sequences.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { ModuleSettingsService } from '../../../core/module-registry/module-settings.service';
import { TransportOrdersService } from '../transport-orders/transport-orders.service';
import { DeliveryExceptionsService } from '../delivery-exceptions/delivery-exceptions.service';
import {
  CreateDeliveryPackageDto,
  EditDeliveryPackageDto,
  TransitionDeliveryPackageDto,
} from './delivery-packages.dto';

type Tx = Prisma.TransactionClient;
/** Server-only capability guard; never populated from a request body. */
export type DriverPackageAuthority = {
  source: { kind: 'DRIVER_LINK'; linkFingerprint: string; loadId: string };
  authorize: (tx: Tx, replay: boolean) => Promise<void>;
};
type Receipt = {
  operationKey: string;
  packageId: string;
  code: string;
  version: number;
  status: string;
};
const nextVersion = (date: Date) => new Date(Math.max(Date.now(), date.getTime() + 1));
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));

@Injectable()
export class DeliveryPackagesService {
  private readonly logger = new Logger(DeliveryPackagesService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: SequencesService,
    private readonly audit: AuditLogsService,
    private readonly settings: ModuleSettingsService,
    private readonly orders: TransportOrdersService,
    @Optional() private readonly exceptions?: DeliveryExceptionsService,
  ) {}

  async list(tenantId: string, loadId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const load = await tx.load.findFirst({
          where: { tenantId, id: loadId },
          select: { id: true, loadNumber: true, status: true, updatedAt: true },
        });
        if (!load) throw new NotFoundException('Chargement introuvable.');
        const shipments = await tx.shipment.findMany({
          where: { tenantId, loadId },
          orderBy: { shipmentNumber: 'asc' },
          take: 201,
          select: {
            id: true,
            shipmentNumber: true,
            status: true,
            updatedAt: true,
            packageTrackingEnabledAt: true,
            originLocation: { select: { name: true } },
            destinationLocation: { select: { name: true } },
          },
        });
        if (shipments.length > 200)
          throw new BadRequestException('Ce poste accepte au plus 200 expéditions par chargement.');
        const packages = await tx.deliveryPackage.findMany({
          where: { tenantId, shipmentId: { in: shipments.map((s) => s.id) } },
          orderBy: { code: 'asc' },
          take: 2001,
        });
        if (packages.length > 2000)
          throw new BadRequestException('Ce poste accepte au plus 2 000 colis par chargement.');
        return {
          load,
          shipments: shipments.map(({ originLocation, destinationLocation, ...s }) => ({
            ...s,
            originName: originLocation.name,
            destinationName: destinationLocation.name,
            packages: packages.filter((p) => p.shipmentId === s.id).map((p) => this.project(p)),
          })),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async events(tenantId: string, packageId: string) {
    if (
      !(await this.prisma.deliveryPackage.findFirst({
        where: { tenantId, id: packageId },
        select: { id: true },
      }))
    )
      throw new NotFoundException('Colis introuvable.');
    return this.prisma.deliveryPackageEvent.findMany({
      where: { tenantId, packageId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
      select: { id: true, kind: true, snapshot: true, createdAt: true },
    });
  }
  private project(p: DeliveryPackage) {
    return {
      id: p.id,
      shipmentId: p.shipmentId,
      code: p.code,
      label: p.label,
      status: p.status,
      contents: p.contents,
      version: p.version,
      loadedLoadId: p.loadedLoadId,
      loadedAt: p.loadedAt,
      deliveredAt: p.deliveredAt,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }
  private content(dto: { label: string; contents: unknown[] }) {
    try {
      return {
        label: normalizeDeliveryPackageLabel(dto.label),
        contents: validateDeliveryPackageContents(dto.contents),
      };
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Contenu invalide.');
    }
  }
  /** Serialize even requests reusing the same operation key on different packages. */
  private async replay(
    tx: Tx,
    tenantId: string,
    actorId: string,
    operationKey: string,
    body: unknown,
  ) {
    operationKey = operationKey.toLowerCase();
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ actorId, body }))
      .digest('hex');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`delivery-package:${tenantId}:${operationKey}`}, 0))`;
    const event = await tx.deliveryPackageEvent.findFirst({ where: { tenantId, operationKey } });
    if (event && (event.actorId !== actorId || event.fingerprint !== fingerprint))
      throw new ConflictException('Cette clé a déjà servi pour une autre demande.');
    return {
      fingerprint,
      receipt: event ? (event.snapshot as unknown as { receipt: Receipt }).receipt : null,
    };
  }
  /** Existing dispatch/assignment writers lock load before shipment, too. */
  private async context(tx: Tx, tenantId: string, shipmentId: string) {
    const initial = await tx.shipment.findFirst({
      where: { tenantId, id: shipmentId },
      select: { loadId: true },
    });
    if (!initial) throw new NotFoundException('Expédition introuvable.');
    if (initial.loadId)
      await tx.$queryRaw`SELECT id FROM loads WHERE id = ${initial.loadId} AND "tenantId" = ${tenantId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM shipments WHERE id = ${shipmentId} AND "tenantId" = ${tenantId} FOR UPDATE`;
    const shipment = await tx.shipment.findFirst({ where: { tenantId, id: shipmentId } });
    if (!shipment) throw new NotFoundException('Expédition introuvable.');
    if (shipment.loadId !== initial.loadId)
      throw new ConflictException('Affectation modifiée. Rechargez le dossier.');
    const load = shipment.loadId
      ? await tx.load.findFirst({
          where: { tenantId, id: shipment.loadId },
          include: { route: { include: { stops: { where: { tenantId } } } } },
        })
      : null;
    return { shipment, load };
  }
  private editable(context: Awaited<ReturnType<DeliveryPackagesService['context']>>) {
    if (
      !['PENDING', 'PLANNED'].includes(context.shipment.status) ||
      (context.load && !['OPEN', 'PLANNED'].includes(context.load.status))
    )
      throw new ConflictException('Le contenu se prépare avant engagement du chargement.');
  }
  private async touch(
    tx: Tx,
    tenantId: string,
    { load, shipment }: Awaited<ReturnType<DeliveryPackagesService['context']>>,
  ) {
    if (load)
      await tx.load.updateMany({
        where: { tenantId, id: load.id },
        data: { updatedAt: nextVersion(load.updatedAt) },
      });
    await tx.shipment.updateMany({
      where: { tenantId, id: shipment.id },
      data: {
        updatedAt: nextVersion(shipment.updatedAt),
        packageTrackingEnabledAt: shipment.packageTrackingEnabledAt ?? new Date(),
      },
    });
  }
  private async record(
    tx: Tx,
    tenantId: string,
    actorId: string,
    operationKey: string,
    fingerprint: string,
    kind: string,
    p: DeliveryPackage,
    evidence: unknown,
    source?: DriverPackageAuthority['source'],
  ) {
    operationKey = operationKey.toLowerCase();
    const receipt: Receipt = {
      operationKey,
      packageId: p.id,
      code: p.code,
      version: p.version,
      status: p.status,
    };
    await tx.deliveryPackageEvent.create({
      data: {
        tenantId,
        packageId: p.id,
        actorId,
        operationKey,
        fingerprint,
        kind,
        snapshot: json({ version: 1, receipt, package: this.project(p), evidence }),
      },
    });
    await this.audit.log(
      {
        tenantId,
        userId: actorId,
        action: kind === 'CREATED' ? AuditAction.CREATE : AuditAction.UPDATE,
        entityType: 'delivery-package',
        entityId: p.id,
        after: { kind, ...receipt, ...(source ? { source } : {}) },
      },
      tx,
    );
    return receipt;
  }
  async create(
    tenantId: string,
    actorId: string,
    shipmentId: string,
    dto: CreateDeliveryPackageDto,
  ) {
    const content = this.content(dto);
    return this.prisma.$transaction(async (tx) => {
      const operation = await this.replay(tx, tenantId, actorId, dto.operationKey, {
        kind: 'CREATE',
        shipmentId,
        expectedUpdatedAt: dto.expectedUpdatedAt,
        ...content,
      });
      if (operation.receipt) return operation.receipt;
      const context = await this.context(tx, tenantId, shipmentId);
      this.editable(context);
      if (
        context.shipment.updatedAt.toISOString() !== new Date(dto.expectedUpdatedAt).toISOString()
      )
        throw new ConflictException('Expédition modifiée. Rechargez-la.');
      if ((await tx.deliveryPackage.count({ where: { tenantId, shipmentId } })) >= 200)
        throw new BadRequestException('Maximum 200 colis par expédition pour ce poste.');
      if (
        context.load &&
        (await tx.deliveryPackage.count({
          where: { tenantId, shipment: { tenantId, loadId: context.load.id } },
        })) >= 2000
      )
        throw new BadRequestException('Maximum 2 000 colis par chargement pour ce poste.');
      const code = await this.sequences.nextNumber(tenantId, 'delivery-package', tx);
      const p = await tx.deliveryPackage.create({
        data: {
          tenantId,
          shipmentId,
          code,
          label: content.label,
          contents: json(content.contents),
        },
      });
      // Adding an active package invalidates a previously complete pickup declaration.
      await tx.shipment.updateMany({
        where: { tenantId, id: shipmentId },
        data: { actualPickupAt: null },
      });
      await this.touch(tx, tenantId, context);
      return this.record(
        tx,
        tenantId,
        actorId,
        dto.operationKey,
        operation.fingerprint,
        'CREATED',
        p,
        { shipmentId },
      );
    });
  }
  async edit(tenantId: string, actorId: string, id: string, dto: EditDeliveryPackageDto) {
    const content = this.content(dto);
    return this.prisma.$transaction(async (tx) => {
      const operation = await this.replay(tx, tenantId, actorId, dto.operationKey, {
        kind: 'EDIT',
        id,
        expectedVersion: dto.expectedVersion,
        ...content,
      });
      if (operation.receipt) return operation.receipt;
      const initial = await tx.deliveryPackage.findFirst({ where: { tenantId, id } });
      if (!initial) throw new NotFoundException('Colis introuvable.');
      const context = await this.context(tx, tenantId, initial.shipmentId);
      const p = await tx.deliveryPackage.findFirstOrThrow({ where: { tenantId, id } });
      this.editable(context);
      if (p.version !== dto.expectedVersion || p.status !== DeliveryPackageStatus.PREPARED)
        throw new ConflictException('Colis modifié ou déjà chargé.');
      if (
        JSON.stringify(validateDeliveryPackageContents(p.contents)) !== JSON.stringify(content.contents) &&
        (await tx.deliveryContentAllocation.count({
          where: { tenantId, packageId: id, releasedAt: null },
        }))
      )
        throw new ConflictException(
          'Libérez les liens de contenu avant de modifier les articles du colis.',
        );
      const updated = await tx.deliveryPackage.update({
        where: { tenantId_id: { tenantId, id } },
        data: { label: content.label, contents: json(content.contents), version: { increment: 1 } },
      });
      await this.touch(tx, tenantId, context);
      return this.record(
        tx,
        tenantId,
        actorId,
        dto.operationKey,
        operation.fingerprint,
        'EDITED',
        updated,
        { previousVersion: p.version },
      );
    });
  }
  async transition(
    tenantId: string,
    actorId: string,
    id: string,
    dto: TransitionDeliveryPackageDto,
    driver?: DriverPackageAuthority,
  ) {
    const recipientName = dto.recipientName?.trim() ?? '',
      notes = dto.notes?.trim() ?? '';
    if (dto.target === DeliveryPackageStatus.RETURNED)
      throw new BadRequestException(
        'Confirmez la réception physique depuis le dossier de retour autorisé.',
      );
    if (dto.target === DeliveryPackageStatus.DELIVERED && !recipientName)
      throw new BadRequestException('Indiquez le destinataire ayant reçu le colis.');
    const tms = await this.settings.resolve(tenantId, 'transportation');
    let completedOrderId: string | null = null;
    const receipt = await this.prisma.$transaction(async (tx) => {
      const operation = await this.replay(tx, tenantId, actorId, dto.operationKey, {
        kind: 'TRANSITION',
        id,
        expectedVersion: dto.expectedVersion,
        target: dto.target,
        expectedLoadId: dto.expectedLoadId,
        expectedLoadUpdatedAt: dto.expectedLoadUpdatedAt,
        recipientName,
        notes,
        ...(driver ? { source: driver.source } : {}),
      });
      // A replay is a receipt, not an authorization bypass: revalidate the live
      // capability and assignment under the same load lock before returning it.
      if (driver) await driver.authorize(tx, !!operation.receipt);
      if (operation.receipt) return operation.receipt;
      const initial = await tx.deliveryPackage.findFirst({ where: { tenantId, id } });
      if (!initial) throw new NotFoundException('Colis introuvable.');
      const context = await this.context(tx, tenantId, initial.shipmentId);
      const { shipment, load } = context;
      if (
        !load ||
        load.id !== dto.expectedLoadId ||
        load.updatedAt.toISOString() !== new Date(dto.expectedLoadUpdatedAt).toISOString()
      )
        throw new ConflictException(
          'Le chargement ou ses ressources ont changé. Rechargez avant confirmation.',
        );
      const p = await tx.deliveryPackage.findFirstOrThrow({ where: { tenantId, id } });
      if (p.version !== dto.expectedVersion)
        throw new ConflictException('Colis modifié. Rechargez-le avant confirmation.');
      if (!canTransitionDeliveryPackage(p.status as DeliveryPackageStatus, dto.target))
        throw new ConflictException('Transition du colis impossible.');
      await this.exceptions?.beforePackageTransitionTx(
        tx,
        tenantId,
        actorId,
        id,
        dto.target,
        dto.operationKey,
        operation.fingerprint,
      );
      const now = new Date();
      let data: Prisma.DeliveryPackageUncheckedUpdateInput = {
        status: dto.target,
        version: { increment: 1 },
      };
      if (dto.target === DeliveryPackageStatus.CANCELLED) {
        this.editable(context);
        if (
          await tx.deliveryContentAllocation.count({
            where: { tenantId, packageId: id, releasedAt: null },
          })
        )
          throw new ConflictException(
            'Libérez explicitement les liens de contenu avant annulation du colis.',
          );
      } else {
        if (!load || !['PLANNED', 'TENDERED', 'DISPATCHED', 'IN_TRANSIT'].includes(load.status))
          throw new ConflictException('Affectez le colis à un chargement actif.');
        if (!['PLANNED', 'DISPATCHED', 'IN_TRANSIT'].includes(shipment.status))
          throw new ConflictException('Expédition non exécutable.');
        if (dto.target === DeliveryPackageStatus.PREPARED) {
          if (load.status === 'IN_TRANSIT' || p.loadedLoadId !== load.id)
            throw new ConflictException('Le retrait du camion est permis seulement avant transit.');
          data = { ...data, loadedLoadId: null, loadedAt: null };
        } else if (dto.target === DeliveryPackageStatus.LOADED) {
          if (load.status === 'IN_TRANSIT') this.checkStop(context, 'PICKUP');
          data = { ...data, loadedLoadId: load.id, loadedAt: now };
        } else if (dto.target === DeliveryPackageStatus.DELIVERED) {
          if (
            load.status !== 'IN_TRANSIT' ||
            shipment.status !== ShipmentStatus.IN_TRANSIT ||
            p.loadedLoadId !== load.id
          )
            throw new ConflictException('Le colis doit être chargé dans cette tournée en transit.');
          this.checkStop(context, 'DELIVERY');
          data.deliveredAt = now;
        }
      }
      const updated = await tx.deliveryPackage.update({
        where: { tenantId_id: { tenantId, id } },
        data,
      });
      if (dto.target === DeliveryPackageStatus.LOADED) {
        const pendingPickup = await tx.deliveryPackage.count({
          where: {
            tenantId,
            shipmentId: shipment.id,
            status: {
              notIn: [
                DeliveryPackageStatus.LOADED,
                DeliveryPackageStatus.DELIVERED,
                DeliveryPackageStatus.CANCELLED,
              ],
            },
          },
        });
        if (!pendingPickup && !shipment.actualPickupAt)
          await tx.shipment.updateMany({
            where: { tenantId, id: shipment.id },
            data: { actualPickupAt: now },
          });
      }
      if (dto.target === DeliveryPackageStatus.PREPARED) {
        await tx.shipment.updateMany({
          where: { tenantId, id: shipment.id },
          data: { actualPickupAt: null },
        });
      }
      if (dto.target === DeliveryPackageStatus.DELIVERED) {
        const remaining = await tx.deliveryPackage.count({
          where: {
            tenantId,
            shipmentId: shipment.id,
            status: { notIn: [DeliveryPackageStatus.DELIVERED, DeliveryPackageStatus.CANCELLED] },
          },
        });
        if (!remaining) {
          if (
            tms['podRequiredBeforeCompletion'] === true &&
            !(await tx.proofOfDelivery.findFirst({
              where: { tenantId, shipmentId: shipment.id },
              select: { id: true },
            }))
          )
            throw new ConflictException(
              'Capturez le POD exigé avant de confirmer le dernier colis.',
            );
          if (!canTransitionShipment(shipment.status as ShipmentStatus, ShipmentStatus.DELIVERED))
            throw new ConflictException('Livraison de cette expédition impossible.');
          await tx.shipment.updateMany({
            where: { tenantId, id: shipment.id, status: shipment.status },
            data: { status: ShipmentStatus.DELIVERED, actualDeliveryAt: now },
          });
          await tx.trackingEvent.create({
            data: {
              tenantId,
              shipmentId: shipment.id,
              type: TrackingEventType.DELIVERED,
              message: 'Tous les colis déclarés de cette expédition ont été livrés.',
              recordedById: actorId,
            },
          });
          await this.audit.log(
            {
              tenantId,
              userId: actorId,
              action: AuditAction.STATUS_CHANGE,
              entityType: 'shipment',
              entityId: shipment.id,
              before: { status: shipment.status },
              after: {
                status: ShipmentStatus.DELIVERED,
                actualDeliveryAt: now.toISOString(),
                source: 'delivery-packages',
              },
            },
            tx,
          );
          completedOrderId = shipment.transportOrderId;
        }
      }
      await this.touch(tx, tenantId, context);
      return this.record(
        tx,
        tenantId,
        actorId,
        dto.operationKey,
        operation.fingerprint,
        dto.target,
        updated,
        {
          ...(driver ? { source: driver.source } : {}),
          recipientName: recipientName || null,
          notes: notes || null,
          shipmentId: shipment.id,
          originLocationId: shipment.originLocationId,
          destinationLocationId: shipment.destinationLocationId,
          load: load
            ? {
                id: load.id,
                loadNumber: load.loadNumber,
                vehicleId: load.vehicleId,
                trailerId: load.trailerId,
                driverId: load.driverId,
              }
            : null,
        },
        driver?.source,
      );
    });
    if (completedOrderId) {
      try {
        const open = await this.prisma.shipment.count({
          where: {
            tenantId,
            transportOrderId: completedOrderId,
            status: {
              notIn: [ShipmentStatus.DELIVERED, ShipmentStatus.CLOSED, ShipmentStatus.CANCELLED],
            },
          },
        });
        if (!open) await this.orders.completeFromDelivery(tenantId, actorId, completedOrderId);
      } catch {
        this.logger.warn('Complétion de commande à reprendre à la clôture du chargement.');
      }
    }
    return receipt;
  }
  async driverException(
    tenantId: string,
    actorId: string,
    id: string,
    dto: {
      operationKey: string;
      expectedVersion: number;
      expectedLoadUpdatedAt: string;
      kind: 'DAMAGE' | 'REFUSED' | 'MISSING' | 'ABSENT' | 'OTHER';
      note: string;
    },
    driver: DriverPackageAuthority,
  ) {
    const note = dto.note.trim();
    if (!note) throw new BadRequestException('Décrivez le problème constaté.');
    return this.prisma.$transaction(async (tx) => {
      const operation = await this.replay(tx, tenantId, actorId, dto.operationKey, {
        kind: 'DRIVER_EXCEPTION',
        id,
        expectedVersion: dto.expectedVersion,
        expectedLoadUpdatedAt: dto.expectedLoadUpdatedAt,
        incidentKind: dto.kind,
        note,
        source: driver.source,
      });
      await driver.authorize(tx, !!operation.receipt);
      if (operation.receipt) return operation.receipt;
      const initial = await tx.deliveryPackage.findFirst({ where: { tenantId, id } });
      if (!initial) throw new NotFoundException('Colis introuvable.');
      const context = await this.context(tx, tenantId, initial.shipmentId);
      const p = await tx.deliveryPackage.findFirstOrThrow({ where: { tenantId, id } });
      if (
        !context.load ||
        context.load.id !== driver.source.loadId ||
        context.load.updatedAt.toISOString() !==
          new Date(dto.expectedLoadUpdatedAt).toISOString() ||
        p.version !== dto.expectedVersion
      )
        throw new ConflictException(
          'La tournée ou le colis a changé. Rechargez avant de signaler.',
        );
      if (
        [DeliveryPackageStatus.CANCELLED, DeliveryPackageStatus.RETURNED].includes(
          p.status as DeliveryPackageStatus,
        )
      )
        throw new ConflictException('Ce colis est annulé ou retourné.');
      const evidence = { source: driver.source, kind: dto.kind, note };
      // Open an actionable case; no stock, delivery status or POD is inferred.
      await this.exceptions?.openFromDriverTx(
        tx,
        tenantId,
        actorId,
        id,
        context.load.id,
        dto.operationKey,
        operation.fingerprint,
        dto.kind,
        note,
        driver.source,
      );
      if (this.exceptions) {
        await tx.deliveryPackage.updateMany({
          where: { tenantId, id },
          data: { version: { increment: 1 } },
        });
        await this.touch(tx, tenantId, context);
      }
      await tx.trackingEvent.create({
        data: {
          tenantId,
          loadId: context.load.id,
          shipmentId: context.shipment.id,
          type: TrackingEventType.EXCEPTION,
          recordedById: actorId,
          // Tracking messages reach public recipient views; private detail stays in payload/journal.
          message: 'Incident signalé par le chauffeur.',
          payload: json({ ...evidence, packageId: p.id, code: p.code }),
        },
      });
      return this.record(
        tx,
        tenantId,
        actorId,
        dto.operationKey,
        operation.fingerprint,
        'DRIVER_EXCEPTION',
        this.exceptions
          ? await tx.deliveryPackage.findFirstOrThrow({ where: { tenantId, id } })
          : p,
        evidence,
        driver.source,
      );
    });
  }
  private checkStop(
    { load, shipment }: Awaited<ReturnType<DeliveryPackagesService['context']>>,
    type: 'PICKUP' | 'DELIVERY',
  ) {
    if (!load?.route?.deliveryPlan) return;
    const stop = load.route.stops.find((s) => s.shipmentId === shipment.id && s.type === type);
    if (!stop || !['ARRIVED', 'DEPARTED', 'COMPLETED'].includes(stop.status))
      throw new ConflictException(
        type === 'DELIVERY'
          ? 'Confirmez l’arrivée à cet arrêt de livraison avant les colis.'
          : 'Confirmez l’arrivée à cet arrêt de ramassage avant le chargement.',
      );
  }
}
