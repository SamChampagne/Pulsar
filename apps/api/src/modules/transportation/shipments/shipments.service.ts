import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditAction, LoadStatus, ShipmentStatus, checkCapacity } from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { randomBytes } from 'node:crypto';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { paginated, paginationArgs } from '../../../common/pagination';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { LoadCostService } from '../loads/load-cost.service';
import { projectShipmentComment, type ShipmentCommentView } from '../../customer-portal/portal.service';

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

  async list(tenantId: string, query: ListQueryDto & { status?: ShipmentStatus; unassigned?: boolean }) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where: Prisma.ShipmentWhereInput = {
      tenantId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? { shipmentNumber: { contains: query.search, mode: 'insensitive' } }
        : {}),
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
  async assignToLoad(tenantId: string, userId: string, id: string, dto: { loadId: string; force?: boolean }) {
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
          { weightKg: shipment.weightKg, volumeM3: shipment.volumeM3, palletCount: shipment.palletCount },
        ];
        const sum = (values: (number | null)[]) =>
          values.some((v) => v !== null) ? values.reduce<number>((acc, v) => acc + (v ?? 0), 0) : null;
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
        if (excesses.length > 0 && !dto.force) {
          throw new BadRequestException({ message: 'Trailer capacity exceeded', excesses });
        }
        if (excesses.length > 0 && dto.force) {
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
    const siblingsCount = await this.prisma.shipment.count({ where: { loadId: dto.loadId, tenantId } });
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

    const txOps: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.shipment.update({
        where: { id },
        data: { loadId: dto.loadId, status: ShipmentStatus.PLANNED },
        include: shipmentInclude,
      }),
      // Junction mirrors the denormalized loadId in the SAME transaction (spec invariant).
      this.prisma.shipmentLoadLeg.upsert({
        where: { shipmentId_sequence: { shipmentId: id, sequence: 1 } },
        update: { loadId: dto.loadId },
        create: { tenantId, shipmentId: id, loadId: dto.loadId, sequence: 1 },
      }),
    ];

    if (modeUpdateNeeded) {
      // First shipment on this load: inherit the order's transport mode.
      txOps.push(this.prisma.load.update({ where: { id: dto.loadId }, data: { mode: orderMode } }));
    }

    const [updated] = (await this.prisma.$transaction(txOps)) as [
      Awaited<ReturnType<typeof this.prisma.shipment.update>>,
      ...unknown[],
    ];

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
    return this.prisma.shipment.update({
      where: { id },
      data: { status: ShipmentStatus.CANCELLED },
      include: shipmentInclude,
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
    const [updated] = await this.prisma.$transaction([
      this.prisma.shipment.update({
        where: { id },
        data: { loadId: null, status: ShipmentStatus.PENDING },
        include: shipmentInclude,
      }),
      // Junction follows the pool return in the SAME transaction (spec invariant).
      this.prisma.shipmentLoadLeg.deleteMany({ where: { shipmentId: id } }),
    ]);
    if (previousLoadId) {
      await this.cost.recompute(tenantId, previousLoadId);
    }
    return updated;
  }
}
