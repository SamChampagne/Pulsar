import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma, type DeliveryException } from '@pulsar/database';
import {
  ACTIVE_DELIVERY_EXCEPTIONS,
  AuditAction,
  DeliveryExceptionStatus,
  DeliveryPackageStatus,
  TrackingEventType,
  canTransitionDeliveryException,
  canTransitionDeliveryPackage,
  deliveryExceptionNextAction,
} from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import {
  CreateDeliveryExceptionDto,
  TransitionDeliveryExceptionDto,
} from './delivery-exceptions.dto';

type Tx = Prisma.TransactionClient;
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const next = (value: Date) => new Date(Math.max(Date.now(), value.getTime() + 1));
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

@Injectable()
export class DeliveryExceptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async list(tenantId: string, loadId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const load = await tx.load.findFirst({
          where: { tenantId, id: loadId },
          select: { id: true, loadNumber: true, status: true, updatedAt: true },
        });
        if (!load) throw new NotFoundException('Chargement introuvable.');
        const rows = await tx.deliveryException.findMany({
          where: { tenantId, loadId },
          orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
          take: 201,
          include: {
            package: {
              select: { id: true, code: true, status: true, version: true, shipmentId: true },
            },
            returnLocation: { select: { id: true, name: true } },
            events: {
              where: { tenantId },
              orderBy: { createdAt: 'desc' },
              take: 10,
              select: { snapshot: true, createdAt: true },
            },
          },
        });
        return {
          load,
          truncated: rows.length > 200,
          cases: rows.slice(0, 200).map((row) => ({
            ...row,
            nextAction: deliveryExceptionNextAction(row.status as DeliveryExceptionStatus),
          })),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private async replay(
    tx: Tx,
    tenantId: string,
    actorId: string,
    operationKey: string,
    body: unknown,
  ) {
    const key = operationKey.toLowerCase(),
      fingerprint = hash({ actorId, body });
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`delivery-exception:${tenantId}:${key}`}, 0))`;
    const old = await tx.deliveryExceptionEvent.findFirst({
      where: { tenantId, operationKey: key },
    });
    if (old && (old.actorId !== actorId || old.fingerprint !== fingerprint))
      throw new ConflictException('Cette clé désigne une autre demande.');
    return {
      key,
      fingerprint,
      receipt: old ? (old.snapshot as { receipt?: unknown }).receipt : null,
    };
  }

  private async context(tx: Tx, tenantId: string, packageId: string) {
    const first = await tx.deliveryPackage.findFirst({
      where: { tenantId, id: packageId },
      select: { shipmentId: true, shipment: { select: { loadId: true } } },
    });
    if (!first?.shipment.loadId) throw new NotFoundException('Colis affecté introuvable.');
    const loadId = first.shipment.loadId;
    await tx.$queryRaw`SELECT id FROM loads WHERE id = ${loadId} AND "tenantId" = ${tenantId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM shipments WHERE id = ${first.shipmentId} AND "tenantId" = ${tenantId} FOR UPDATE`;
    const p = await tx.deliveryPackage.findFirstOrThrow({
      where: { tenantId, id: packageId },
      include: { shipment: true },
    });
    const load = await tx.load.findFirstOrThrow({ where: { tenantId, id: loadId } });
    if (p.shipment.loadId !== loadId)
      throw new ConflictException('Affectation modifiée. Rechargez.');
    return { p, load };
  }
  private validateContext(
    context: Awaited<ReturnType<DeliveryExceptionsService['context']>>,
    version: number,
    loadVersion: string,
  ) {
    if (
      context.p.version !== version ||
      context.load.updatedAt.toISOString() !== new Date(loadVersion).toISOString()
    )
      throw new ConflictException('Colis ou tournée modifié. Rechargez avant de décider.');
    if (!['DISPATCHED', 'IN_TRANSIT', 'COMPLETED'].includes(context.load.status))
      throw new ConflictException('Le suivi des incidents exige une tournée expédiée.');
    if (['CANCELLED', 'RETURNED'].includes(context.p.status))
      throw new ConflictException('Ce colis est terminé ou annulé.');
  }
  private async touch(
    tx: Tx,
    tenantId: string,
    context: Awaited<ReturnType<DeliveryExceptionsService['context']>>,
  ) {
    await tx.deliveryPackage.updateMany({
      where: { tenantId, id: context.p.id },
      data: { version: { increment: 1 } },
    });
    await tx.load.updateMany({
      where: { tenantId, id: context.load.id },
      data: { updatedAt: next(context.load.updatedAt) },
    });
    await tx.shipment.updateMany({
      where: { tenantId, id: context.p.shipmentId },
      data: { updatedAt: next(context.p.shipment.updatedAt) },
    });
  }
  private async record(
    tx: Tx,
    tenantId: string,
    actorId: string,
    key: string,
    fingerprint: string,
    row: DeliveryException,
    before?: DeliveryException,
    source?: unknown,
  ) {
    const receipt = { id: row.id, status: row.status, version: row.version, operationKey: key };
    await tx.deliveryExceptionEvent.create({
      data: {
        tenantId,
        exceptionId: row.id,
        actorId,
        operationKey: key,
        fingerprint,
        snapshot: json({ receipt, before: before ?? null, after: row, source: source ?? null }),
      },
    });
    await this.audit.log(
      {
        tenantId,
        userId: actorId,
        action: before ? AuditAction.STATUS_CHANGE : AuditAction.CREATE,
        entityType: 'delivery-exception',
        entityId: row.id,
        before: before ? { status: before.status, version: before.version } : undefined,
        after: receipt,
      },
      tx,
    );
    return receipt;
  }
  /** Caller already holds the package operation, load and shipment locks and validated the live capability. */
  async openFromDriverTx(
    tx: Tx,
    tenantId: string,
    actorId: string,
    packageId: string,
    loadId: string,
    operationKey: string,
    fingerprint: string,
    kind: string,
    note: string,
    source: unknown,
  ) {
    if (
      await tx.deliveryException.count({
        where: { tenantId, packageId, status: { in: [...ACTIVE_DELIVERY_EXCEPTIONS] } },
      })
    )
      throw new ConflictException('Un incident actif existe déjà pour ce colis.');
    const row = await tx.deliveryException.create({
      data: { tenantId, packageId, loadId, kind, note },
    });
    await this.record(
      tx,
      tenantId,
      actorId,
      operationKey.toLowerCase(),
      fingerprint,
      row,
      undefined,
      source,
    );
    return row;
  }
  async create(tenantId: string, actorId: string, dto: CreateDeliveryExceptionDto) {
    const note = dto.note.trim();
    if (!note) throw new BadRequestException('Décrivez le problème.');
    return this.prisma.$transaction(async (tx) => {
      const op = await this.replay(tx, tenantId, actorId, dto.operationKey, {
        action: 'CREATE',
        ...dto,
        note,
      });
      if (op.receipt) return op.receipt;
      const context = await this.context(tx, tenantId, dto.packageId);
      this.validateContext(context, dto.expectedPackageVersion, dto.expectedLoadUpdatedAt);
      if (
        await tx.deliveryException.count({
          where: {
            tenantId,
            packageId: dto.packageId,
            status: { in: [...ACTIVE_DELIVERY_EXCEPTIONS] },
          },
        })
      )
        throw new ConflictException(
          'Traitez le dossier actif avant de signaler un nouvel incident.',
        );
      const row = await tx.deliveryException.create({
        data: { tenantId, packageId: dto.packageId, loadId: context.load.id, kind: dto.kind, note },
      });
      await this.touch(tx, tenantId, context);
      await tx.trackingEvent.create({
        data: {
          tenantId,
          loadId: context.load.id,
          shipmentId: context.p.shipmentId,
          type: TrackingEventType.EXCEPTION,
          recordedById: actorId,
          message: 'Incident de livraison en cours de traitement.',
        },
      });
      return this.record(tx, tenantId, actorId, op.key, op.fingerprint, row);
    });
  }
  async transition(
    tenantId: string,
    actorId: string,
    id: string,
    dto: TransitionDeliveryExceptionDto,
  ) {
    const note = dto.note.trim();
    if (!note) throw new BadRequestException('Expliquez la décision.');
    return this.prisma.$transaction(async (tx) => {
      // Physical reception is never performed by an agent or a driver capability/service account.
      if (dto.target === DeliveryExceptionStatus.RETURN_RECEIVED) {
        const actor = await tx.user.findFirst({
          where: {
            tenantId,
            id: actorId,
            agentServiceFor: { none: {} },
            NOT: { email: 'service-account@pulsar.local' },
          },
          select: { status: true },
        });
        if (actor?.status !== 'ACTIVE')
          throw new ForbiddenException('La réception physique exige un utilisateur actif.');
      }
      const op = await this.replay(tx, tenantId, actorId, dto.operationKey, {
        action: 'TRANSITION',
        id,
        ...dto,
        note,
      });
      if (op.receipt) return op.receipt;
      const first = await tx.deliveryException.findFirst({ where: { tenantId, id } });
      if (!first) throw new NotFoundException('Incident introuvable.');
      const context = await this.context(tx, tenantId, first.packageId);
      this.validateContext(context, dto.expectedPackageVersion, dto.expectedLoadUpdatedAt);
      const row = await tx.deliveryException.findFirstOrThrow({ where: { tenantId, id } });
      if (
        row.loadId !== context.load.id ||
        row.version !== dto.expectedVersion ||
        !canTransitionDeliveryException(row.status as DeliveryExceptionStatus, dto.target)
      )
        throw new ConflictException('Décision périmée ou transition impossible.');
      const data: Prisma.DeliveryExceptionUncheckedUpdateInput = {
        status: dto.target,
        version: { increment: 1 },
        note,
        retryAt: null,
      };
      if (dto.target === DeliveryExceptionStatus.RETRY_PLANNED) {
        if (!dto.retryAt || new Date(dto.retryAt).getTime() <= Date.now())
          throw new BadRequestException('Choisissez une prochaine tentative future.');
        if (
          context.load.status !== 'IN_TRANSIT' ||
          context.p.status !== DeliveryPackageStatus.LOADED
        )
          throw new ConflictException(
            'La nouvelle tentative concerne un colis chargé dans la tournée en cours.',
          );
        data.retryAt = new Date(dto.retryAt);
      }
      if (
        [
          DeliveryExceptionStatus.RETURN_AUTHORIZED,
          DeliveryExceptionStatus.RETURN_RECEIVED,
        ].includes(dto.target)
      ) {
        if (
          !canTransitionDeliveryPackage(
            context.p.status as DeliveryPackageStatus,
            DeliveryPackageStatus.RETURNED,
          )
        )
          throw new ConflictException('Le colis doit avoir été pris en charge.');
        const locationId =
          dto.target === DeliveryExceptionStatus.RETURN_RECEIVED
            ? row.returnLocationId
            : dto.returnLocationId;
        const location = locationId
          ? await tx.location.findFirst({
              where: { tenantId, id: locationId, isActive: true },
              select: { id: true, name: true },
            })
          : null;
        if (!location)
          throw new BadRequestException(
            'Sélectionnez un lieu de retour actif de cette entreprise.',
          );
        data.returnLocationId = location.id;
        if (dto.target === DeliveryExceptionStatus.RETURN_RECEIVED) {
          const receivedBy = dto.receivedBy?.trim();
          if (!receivedBy)
            throw new BadRequestException('Indiquez qui a réceptionné physiquement le colis.');
          data.receivedAt = new Date();
          data.receivedBy = receivedBy;
          const result = await tx.deliveryPackage.updateMany({
            where: {
              tenantId,
              id: context.p.id,
              version: context.p.version,
              status: context.p.status,
            },
            data: { status: DeliveryPackageStatus.RETURNED },
          });
          if (result.count !== 1) throw new ConflictException('Colis modifié.');
          await tx.deliveryPackageEvent.create({
            data: {
              tenantId,
              packageId: context.p.id,
              actorId,
              operationKey: op.key,
              fingerprint: op.fingerprint,
              kind: 'RETURNED',
              snapshot: json({
                receipt: {
                  operationKey: op.key,
                  packageId: context.p.id,
                  code: context.p.code,
                  version: context.p.version + 1,
                  status: 'RETURNED',
                },
                evidence: {
                  exceptionId: id,
                  locationId: location.id,
                  locationName: location.name,
                  receivedBy,
                  receivedAt: data.receivedAt,
                  previousStatus: context.p.status,
                  noStockMovement: true,
                },
              }),
            },
          });
          await tx.trackingEvent.create({
            data: {
              tenantId,
              loadId: context.load.id,
              shipmentId: context.p.shipmentId,
              type: TrackingEventType.EXCEPTION,
              recordedById: actorId,
              message: 'Retour de colis réceptionné. Le suivi commercial reste à traiter.',
            },
          });
        }
      }
      const changed = await tx.deliveryException.updateMany({
        where: { tenantId, id, version: dto.expectedVersion, status: row.status },
        data,
      });
      if (changed.count !== 1) throw new ConflictException('Incident modifié.');
      await this.touch(tx, tenantId, context);
      return this.record(
        tx,
        tenantId,
        actorId,
        op.key,
        op.fingerprint,
        await tx.deliveryException.findFirstOrThrow({ where: { tenantId, id } }),
        row,
      );
    });
  }
  /** Called under package/load locks. Successful retry closes its case in the same transaction. */
  async beforePackageTransitionTx(
    tx: Tx,
    tenantId: string,
    actorId: string,
    packageId: string,
    target: DeliveryPackageStatus,
    operationKey: string,
    fingerprint: string,
  ) {
    const row = await tx.deliveryException.findFirst({
      where: { tenantId, packageId, status: { in: [...ACTIVE_DELIVERY_EXCEPTIONS] } },
    });
    if (!row) return;
    if (
      target !== DeliveryPackageStatus.DELIVERED ||
      row.status !== DeliveryExceptionStatus.RETRY_PLANNED
    )
      throw new ConflictException(
        'Traitez l’incident ou autorisez une nouvelle tentative avant cette opération.',
      );
    if (
      !canTransitionDeliveryException(
        row.status as DeliveryExceptionStatus,
        DeliveryExceptionStatus.RESOLVED,
      )
    )
      throw new ConflictException('Incident non résoluble.');
    const updated = await tx.deliveryException.update({
      where: { tenantId_id: { tenantId, id: row.id } },
      data: {
        status: DeliveryExceptionStatus.RESOLVED,
        version: { increment: 1 },
        note: 'Nouvelle tentative confirmée par la livraison du colis.',
      },
    });
    await this.record(
      tx,
      tenantId,
      actorId,
      operationKey.toLowerCase(),
      fingerprint,
      updated,
      row,
      { kind: 'PACKAGE_DELIVERED' },
    );
  }
}
