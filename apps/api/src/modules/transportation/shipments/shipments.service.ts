import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuditAction,
  LoadStatus,
  ShipmentStatus,
  checkCapacity,
  canTransitionShipment,
} from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { randomBytes } from 'node:crypto';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { paginated, paginationArgs } from '../../../common/pagination';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { ModuleSettingsService } from '../../../core/module-registry/module-settings.service';
import { LoadCostService } from '../loads/load-cost.service';
import {
  projectShipmentComment,
  type ShipmentCommentView,
} from '../../customer-portal/portal.service';

const shipmentInclude = {
  transportOrder: { select: { id: true, orderNumber: true, status: true } },
  originLocation: { select: { id: true, code: true, name: true, city: true } },
  destinationLocation: { select: { id: true, code: true, name: true, city: true } },
  load: { select: { id: true, loadNumber: true, status: true } },
} satisfies Prisma.ShipmentInclude;

@Injectable()
export class ShipmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly cost: LoadCostService,
    private readonly audit: AuditLogsService,
    private readonly moduleSettings: ModuleSettingsService,
  ) {}

  /** Generates (or returns) the public read-only tracking link for this shipment. */
  async generateTrackingLink(tenantId: string, id: string) {
    const shipment = await this.get(tenantId, id);
    let token = shipment.trackingToken;
    if (!token) {
      token = randomBytes(24).toString('base64url');
      await this.prisma.shipment.update({ where: { id }, data: { trackingToken: token } });
    }
    return { url: `${this.config.get('WEB_URL', 'http://localhost:5173')}/track/${token}` };
  }

  async revokeTrackingLink(tenantId: string, id: string) {
    await this.get(tenantId, id);
    await this.prisma.shipment.update({ where: { id }, data: { trackingToken: null } });
    return { revoked: true };
  }

  async list(
    tenantId: string,
    query: ListQueryDto & { status?: ShipmentStatus; unassigned?: boolean },
  ) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where: Prisma.ShipmentWhereInput = {
      tenantId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search ? { shipmentNumber: { contains: query.search, mode: 'insensitive' } } : {}),
      ...(query.unassigned ? { loadId: null } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.shipment.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: shipmentInclude,
      }),
      this.prisma.shipment.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  async get(tenantId: string, id: string) {
    const shipment = await this.prisma.shipment.findFirst({
      where: { id, tenantId },
      include: { ...shipmentInclude, proofOfDelivery: true },
    });
    if (!shipment) throw new NotFoundException('Shipment not found');
    return shipment;
  }

  /** Consolidation step: attach a PENDING shipment to an OPEN load. */
  async assignToLoad(
    tenantId: string,
    userId: string,
    id: string,
    dto: { loadId: string; force?: boolean },
  ) {
    const shipment = await this.get(tenantId, id);
    if (shipment.status !== ShipmentStatus.PENDING) {
      throw new BadRequestException('Only PENDING shipments can be assigned to a load');
    }
    const load = await this.prisma.load.findFirst({ where: { id: dto.loadId, tenantId } });
    if (!load) throw new NotFoundException('Load not found');
    if (load.status !== LoadStatus.OPEN && load.status !== LoadStatus.PLANNED) {
      throw new BadRequestException('Shipments can only be added to OPEN or PLANNED loads');
    }
    if (load.trailerId) {
      const trailer = await this.prisma.trailer.findFirst({
        where: { id: load.trailerId, tenantId },
        select: { capacityWeightKg: true, capacityVolumeM3: true, capacityPallets: true },
      });
      if (trailer) {
        const siblings = await this.prisma.shipment.findMany({
          where: { loadId: dto.loadId, tenantId },
          select: { weightKg: true, volumeM3: true, palletCount: true },
        });
        const all = [
          ...siblings,
          {
            weightKg: shipment.weightKg,
            volumeM3: shipment.volumeM3,
            palletCount: shipment.palletCount,
          },
        ];
        const sum = (values: (number | null)[]) =>
          values.some((v) => v !== null)
            ? values.reduce<number>((acc, v) => acc + (v ?? 0), 0)
            : null;
        const excesses = checkCapacity(
          {
            weightKg: trailer.capacityWeightKg,
            volumeM3: trailer.capacityVolumeM3,
            pallets: trailer.capacityPallets,
          },
          {
            weightKg: sum(all.map((s) => s.weightKg)),
            volumeM3: sum(all.map((s) => s.volumeM3)),
            pallets: sum(all.map((s) => s.palletCount)),
          },
        );
        if (excesses.length > 0) {
          const tmsSettings = await this.moduleSettings.resolve(tenantId, 'transportation');
          const overage = tmsSettings['capacityOverage'] as string;
          if (overage === 'BLOCK') {
            throw new ConflictException({
              message: 'Trailer capacity exceeded (blocked by tenant policy)',
              excesses,
            });
          }
          if (!dto.force) {
            throw new BadRequestException({ message: 'Trailer capacity exceeded', excesses });
          }
          // WARN + force: log and continue
          await this.audit.log({
            tenantId,
            userId,
            action: AuditAction.UPDATE,
            entityType: 'load',
            entityId: dto.loadId,
            after: { capacityOverride: true, excesses, shipmentId: id },
          });
        }
      }
    }
    // --- Mode inheritance ---
    const orderMode = (
      await this.prisma.transportOrder.findFirst({
        where: { id: shipment.transportOrderId, tenantId },
        select: { mode: true },
      })
    )?.mode;
    const siblingsCount = await this.prisma.shipment.count({
      where: { loadId: dto.loadId, tenantId },
    });
    let modeWarning: { loadMode: string; orderMode: string } | undefined;

    // Build the transaction. Always: shipment update + junction upsert. Conditionally: load mode update.
    // First-assign inheritance: only inherit when the load's mode is still the default (FTL),
    // meaning the dispatcher has not intentionally set it. If mode was explicitly changed away from
    // FTL, preserve it and surface a warning instead of silently overwriting it.
    const modeUpdateNeeded =
      siblingsCount === 0 && orderMode && orderMode !== load.mode && load.mode === 'FTL';
    if (siblingsCount === 0 && orderMode && orderMode !== load.mode && load.mode !== 'FTL') {
      // Empty load but mode was explicitly set to non-FTL — do not overwrite; warn instead.
      modeWarning = { loadMode: load.mode, orderMode };
    } else if (siblingsCount > 0 && orderMode && orderMode !== load.mode) {
      // Mixed-mode consolidation: non-blocking warning returned to the caller.
      modeWarning = { loadMode: load.mode, orderMode };
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // Serialize membership with route planning and dispatch before changing a shipment.
      const claim = await tx.load.updateMany({
        where: { id: load.id, tenantId, status: load.status, updatedAt: load.updatedAt },
        data: {
          updatedAt: new Date(Math.max(Date.now(), load.updatedAt.getTime() + 1)),
          ...(modeUpdateNeeded ? { mode: orderMode } : {}),
        },
      });
      if (!claim.count)
        throw new ConflictException('Le chargement a changé. Rechargez avant d’affecter.');
      await tx.$queryRaw`SELECT id FROM shipments WHERE id = ${id} AND "tenantId" = ${tenantId} FOR UPDATE`;
      await this.assertNoEngagedPackages(tx, tenantId, id);
      if ((await tx.shipment.count({ where: { tenantId, loadId: dto.loadId } })) >= 200)
        throw new BadRequestException('Maximum 200 expéditions par chargement pour ce poste.');
      const packageCount = await tx.deliveryPackage.count({
        where: {
          tenantId,
          OR: [{ shipmentId: id }, { shipment: { tenantId, loadId: dto.loadId } }],
        },
      });
      if (packageCount > 2000)
        throw new BadRequestException(
          'Maximum 2 000 colis par chargement pour ce poste, historique inclus.',
        );
      if (!canTransitionShipment(ShipmentStatus.PENDING, ShipmentStatus.PLANNED))
        throw new ConflictException('Transition impossible.');
      const assigned = await tx.shipment.updateMany({
        where: { id, tenantId, status: ShipmentStatus.PENDING, loadId: null },
        data: { loadId: dto.loadId, status: ShipmentStatus.PLANNED },
      });
      if (!assigned.count)
        throw new ConflictException('Cette expédition est déjà affectée ou a changé.');
      await tx.shipmentLoadLeg.upsert({
        where: { shipmentId_sequence: { shipmentId: id, sequence: 1 } },
        update: { loadId: dto.loadId },
        create: { tenantId, shipmentId: id, loadId: dto.loadId, sequence: 1 },
      });
      return tx.shipment.findFirstOrThrow({ where: { id, tenantId }, include: shipmentInclude });
    });

    if (modeUpdateNeeded && orderMode) {
      // Audit the automatic mode inheritance so dispatchers can trace why the load mode changed.
      await this.audit.log({
        tenantId,
        userId,
        action: AuditAction.UPDATE,
        entityType: 'load',
        entityId: dto.loadId,
        after: { modeInherited: orderMode, fromOrder: shipment.transportOrderId },
      });
    }

    await this.cost.recompute(tenantId, dto.loadId);
    return { ...updated, ...(modeWarning ? { modeWarning } : {}) };
  }

  /** Cancels an unassigned PENDING shipment (post-planning cleanup). */
  async cancel(tenantId: string, id: string) {
    const shipment = await this.get(tenantId, id);
    if (shipment.status !== ShipmentStatus.PENDING) {
      throw new BadRequestException('Only PENDING shipments can be cancelled');
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM shipments WHERE id = ${id} AND "tenantId" = ${tenantId} FOR UPDATE`;
      await this.assertNoEngagedPackages(tx, tenantId, id);
      if (!canTransitionShipment(ShipmentStatus.PENDING, ShipmentStatus.CANCELLED))
        throw new ConflictException('Transition d’expédition impossible.');
      const cancelled = await tx.shipment.updateMany({
        where: { id, tenantId, status: ShipmentStatus.PENDING, loadId: null },
        data: { status: ShipmentStatus.CANCELLED },
      });
      if (!cancelled.count)
        throw new ConflictException('Cette expédition a changé ou a été affectée.');
      return tx.shipment.findFirstOrThrow({ where: { id, tenantId }, include: shipmentInclude });
    });
  }

  /** Internal: the comment thread for a shipment (tenant-scoped, projected). */
  async listComments(tenantId: string, id: string): Promise<ShipmentCommentView[]> {
    await this.get(tenantId, id); // assertOwned: throws if shipment not in tenant
    const comments = await this.prisma.shipmentComment.findMany({
      where: { tenantId, shipmentId: id },
      orderBy: { createdAt: 'asc' },
    });
    return comments.map(projectShipmentComment);
  }

  /** Internal: a staff user posts a comment on a shipment. */
  async createComment(
    tenantId: string,
    user: { id: string; firstName: string; lastName: string; email: string },
    id: string,
    body: string,
  ): Promise<ShipmentCommentView> {
    await this.get(tenantId, id); // assertOwned: throws if shipment not in tenant
    const authorName = `${user.firstName} ${user.lastName}`.trim() || user.email;
    const comment = await this.prisma.shipmentComment.create({
      data: {
        tenantId,
        shipmentId: id,
        authorType: 'STAFF',
        authorId: user.id,
        authorName,
        body,
      },
    });
    await this.audit.log({
      tenantId,
      userId: user.id,
      action: AuditAction.CREATE,
      entityType: 'shipment-comment',
      entityId: comment.id,
      after: { shipmentId: id, authorType: 'STAFF', author: authorName },
    });
    return projectShipmentComment(comment);
  }

  async removeFromLoad(tenantId: string, id: string) {
    const shipment = await this.get(tenantId, id);
    if (shipment.status !== ShipmentStatus.PLANNED) {
      throw new BadRequestException('Only PLANNED shipments can be removed from a load');
    }
    const previousLoadId = shipment.loadId;
    const updated = await this.prisma.$transaction(async (tx) => {
      if (previousLoadId) {
        const current = await tx.load.findFirst({ where: { id: previousLoadId, tenantId } });
        if (!current) throw new ConflictException('Le chargement a changé.');
        const claim = await tx.load.updateMany({
          where: {
            id: previousLoadId,
            tenantId,
            updatedAt: current.updatedAt,
            status: { in: [LoadStatus.OPEN, LoadStatus.PLANNED] },
          },
          data: { updatedAt: new Date(Math.max(Date.now(), current.updatedAt.getTime() + 1)) },
        });
        if (!claim.count)
          throw new ConflictException('Un chargement engagé ne peut plus perdre une expédition.');
      }
      await tx.$queryRaw`SELECT id FROM shipments WHERE id = ${id} AND "tenantId" = ${tenantId} FOR UPDATE`;
      await this.assertNoEngagedPackages(tx, tenantId, id);
      if (!canTransitionShipment(ShipmentStatus.PLANNED, ShipmentStatus.PENDING))
        throw new ConflictException('Transition impossible.');
      const removed = await tx.shipment.updateMany({
        where: { id, tenantId, loadId: previousLoadId, status: ShipmentStatus.PLANNED },
        data: { loadId: null, status: ShipmentStatus.PENDING },
      });
      if (!removed.count) throw new ConflictException('Cette expédition a changé.');
      await tx.shipmentLoadLeg.deleteMany({ where: { tenantId, shipmentId: id } });
      return tx.shipment.findFirstOrThrow({ where: { id, tenantId }, include: shipmentInclude });
    });
    if (previousLoadId) {
      await this.cost.recompute(tenantId, previousLoadId);
    }
    return updated;
  }

  private async assertNoEngagedPackages(
    tx: Prisma.TransactionClient,
    tenantId: string,
    shipmentId: string,
  ) {
    const engaged = await tx.deliveryPackage.count({
      where: { tenantId, shipmentId, status: { in: ['LOADED', 'DELIVERED', 'RETURNED'] } },
    });
    if (engaged)
      throw new ConflictException(
        'Une expédition avec des colis chargés ou livrés ne peut pas être détachée ou réaffectée.',
      );
  }
}
