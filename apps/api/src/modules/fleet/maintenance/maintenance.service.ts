import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  MaintenanceOrderStatus,
  canTransitionAsset,
  canTransitionMaintenanceOrder,
} from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { OwnershipService } from '../../../prisma/ownership.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { DomainEventsService } from '../../../core/operating/domain-events.service';
import {
  CompleteMaintenanceOrderDto,
  CreateMaintenanceOrderDto,
  MaintenanceListQueryDto,
} from './dto/maintenance.dto';

/**
 * Work orders for fleet assets. A WO targets EXACTLY ONE asset (vehicle XOR
 * trailer). Opening a WO best-effort flips the asset to MAINTENANCE; closing it
 * (complete/cancel) best-effort returns it to AVAILABLE. The asset sync is
 * guarded by canTransitionAsset + a conditional updateMany so a RETIRED asset is
 * never disturbed (rule 2 + TOCTOU). Status moves go through
 * canTransitionMaintenanceOrder; mutations are audited (rule 6); tenant-scoped (rule 1).
 */
@Injectable()
export class MaintenanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly audit: AuditLogsService,
    private readonly domainEvents: DomainEventsService,
  ) {}

  list(tenantId: string, query: MaintenanceListQueryDto) {
    return this.prisma.maintenanceOrder.findMany({
      where: {
        tenantId,
        ...(query.status ? { status: query.status as MaintenanceOrderStatus } : {}),
        ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
        ...(query.trailerId ? { trailerId: query.trailerId } : {}),
      },
      orderBy: { openedAt: 'desc' },
      take: 100,
    });
  }

  async get(tenantId: string, id: string) {
    const wo = await this.prisma.maintenanceOrder.findFirst({ where: { id, tenantId } });
    if (!wo) throw new NotFoundException('Maintenance order not found');
    return wo;
  }

  async create(tenantId: string, userId: string, dto: CreateMaintenanceOrderDto) {
    if (!!dto.vehicleId === !!dto.trailerId) {
      throw new BadRequestException('Exactly one of vehicleId or trailerId is required');
    }
    await this.ownership.assertOwnedIfSet('vehicle', dto.vehicleId, tenantId);
    await this.ownership.assertOwnedIfSet('trailer', dto.trailerId, tenantId);

    const wo = await this.prisma.maintenanceOrder.create({
      data: {
        tenantId,
        vehicleId: dto.vehicleId ?? null,
        trailerId: dto.trailerId ?? null,
        type: dto.type,
        status: MaintenanceOrderStatus.OPEN,
        description: dto.description,
        odometerKm: dto.odometerKm ?? null,
        vendor: dto.vendor ?? null,
        dueDate: dto.dueDate ?? null,
        dueOdometerKm: dto.dueOdometerKm ?? null,
        openedAt: new Date(),
      },
    });

    await this.setAssetStatus(
      tenantId,
      userId,
      dto.vehicleId ?? null,
      dto.trailerId ?? null,
      'MAINTENANCE',
    );

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.CREATE,
      entityType: 'maintenance-order',
      entityId: wo.id,
      after: { type: wo.type, vehicleId: wo.vehicleId, trailerId: wo.trailerId, status: wo.status },
    });

    // Cross-module spine (best-effort): tell the operating workbench an asset left the
    // dispatchable pool. emit() never throws — a failure here must not break the WO.
    const assetKind = dto.vehicleId ? 'vehicle' : 'trailer';
    const assetId = (dto.vehicleId ?? dto.trailerId)!;
    const unitNumber = dto.vehicleId
      ? (
          await this.prisma.vehicle.findFirst({
            where: { id: dto.vehicleId, tenantId },
            select: { unitNumber: true },
          })
        )?.unitNumber
      : (
          await this.prisma.trailer.findFirst({
            where: { id: dto.trailerId, tenantId },
            select: { unitNumber: true },
          })
        )?.unitNumber;
    await this.domainEvents.emit(
      tenantId,
      'fleet.asset.maintenance',
      { type: assetKind, id: assetId },
      {
        assetKind,
        assetId,
        unitNumber: unitNumber ?? null,
        woId: wo.id,
        woType: wo.type,
        description: wo.description,
      },
    );
    return wo;
  }

  async start(tenantId: string, userId: string, id: string) {
    const wo = await this.get(tenantId, id);
    if (
      !canTransitionMaintenanceOrder(
        wo.status as MaintenanceOrderStatus,
        MaintenanceOrderStatus.IN_PROGRESS,
      )
    ) {
      throw new BadRequestException(`Cannot start a ${wo.status} maintenance order`);
    }
    const { count } = await this.prisma.maintenanceOrder.updateMany({
      where: { id, tenantId, status: MaintenanceOrderStatus.OPEN },
      data: { status: MaintenanceOrderStatus.IN_PROGRESS },
    });
    if (count === 0) {
      throw new BadRequestException('Only OPEN maintenance orders can be started');
    }
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'maintenance-order',
      entityId: id,
      before: { status: wo.status },
      after: { status: MaintenanceOrderStatus.IN_PROGRESS },
    });
    return this.get(tenantId, id);
  }

  async complete(tenantId: string, userId: string, id: string, dto: CompleteMaintenanceOrderDto) {
    const wo = await this.get(tenantId, id);
    if (
      !canTransitionMaintenanceOrder(
        wo.status as MaintenanceOrderStatus,
        MaintenanceOrderStatus.COMPLETED,
      )
    ) {
      throw new BadRequestException(`Cannot complete a ${wo.status} maintenance order`);
    }
    const { count } = await this.prisma.maintenanceOrder.updateMany({
      where: {
        id,
        tenantId,
        status: { in: [MaintenanceOrderStatus.OPEN, MaintenanceOrderStatus.IN_PROGRESS] },
      },
      data: {
        status: MaintenanceOrderStatus.COMPLETED,
        completedAt: new Date(),
        ...(dto.costAmount != null ? { costAmount: dto.costAmount } : {}),
        ...(dto.costCurrency ? { costCurrency: dto.costCurrency } : {}),
        ...(dto.odometerKm != null ? { odometerKm: dto.odometerKm } : {}),
      },
    });
    if (count === 0) {
      throw new BadRequestException('Only OPEN or IN_PROGRESS maintenance orders can be completed');
    }
    await this.setAssetStatus(tenantId, userId, wo.vehicleId, wo.trailerId, 'AVAILABLE');
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'maintenance-order',
      entityId: id,
      before: { status: wo.status },
      after: { status: MaintenanceOrderStatus.COMPLETED },
    });
    return this.get(tenantId, id);
  }

  async cancel(tenantId: string, userId: string, id: string) {
    const wo = await this.get(tenantId, id);
    if (
      !canTransitionMaintenanceOrder(
        wo.status as MaintenanceOrderStatus,
        MaintenanceOrderStatus.CANCELLED,
      )
    ) {
      throw new BadRequestException(`Cannot cancel a ${wo.status} maintenance order`);
    }
    const { count } = await this.prisma.maintenanceOrder.updateMany({
      where: {
        id,
        tenantId,
        status: { in: [MaintenanceOrderStatus.OPEN, MaintenanceOrderStatus.IN_PROGRESS] },
      },
      data: { status: MaintenanceOrderStatus.CANCELLED },
    });
    if (count === 0) {
      throw new BadRequestException('Only OPEN or IN_PROGRESS maintenance orders can be cancelled');
    }
    await this.setAssetStatus(tenantId, userId, wo.vehicleId, wo.trailerId, 'AVAILABLE');
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'maintenance-order',
      entityId: id,
      before: { status: wo.status },
      after: { status: MaintenanceOrderStatus.CANCELLED },
    });
    return this.get(tenantId, id);
  }

  /**
   * Best-effort asset status sync. Guarded by canTransitionAsset + status:current
   * in the where clause: a RETIRED (or otherwise non-transitionable) asset is left
   * untouched, never throws. WO lifecycle must not depend on the asset side-effect.
   */
  private async setAssetStatus(
    tenantId: string,
    userId: string,
    vehicleId: string | null,
    trailerId: string | null,
    next: string,
  ): Promise<void> {
    const entityType = vehicleId ? 'vehicle' : trailerId ? 'trailer' : null;
    const id = vehicleId ?? trailerId;
    if (!entityType || !id) return;
    const delegate = this.prisma[entityType] as unknown as {
      findFirst(args: {
        where: { id: string; tenantId: string };
        select: { id: true; status: true };
      }): Promise<{ id: string; status: string } | null>;
      updateMany(args: {
        where: { id: string; tenantId: string; status: string };
        data: { status: string };
      }): Promise<{ count: number }>;
    };
    const asset = await delegate.findFirst({
      where: { id, tenantId },
      select: { id: true, status: true },
    });
    if (!asset) return;
    if (!canTransitionAsset(asset.status, next)) return;
    const { count } = await delegate.updateMany({
      where: { id, tenantId, status: asset.status },
      data: { status: next },
    });
    if (count === 0) return;
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.STATUS_CHANGE,
      entityType,
      entityId: id,
      before: { status: asset.status },
      after: { status: next },
    });
  }
}
