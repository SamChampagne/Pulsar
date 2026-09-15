import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  CustomFieldEntity,
  MaintenanceOrderStatus,
  canTransitionAsset,
  canTransitionMaintenanceOrder,
} from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { PrismaService } from '../../../prisma/prisma.service';
import { OwnershipService } from '../../../prisma/ownership.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { CustomFieldsService } from '../../../core/custom-fields/custom-fields.service';
import { DomainEventsService } from '../../../core/operating/domain-events.service';
import {
  CompleteMaintenanceOrderDto,
  CreateMaintenanceOrderDto,
  MaintenanceListQueryDto,
  MaintenanceVersionDto,
  UpdateMaintenanceOrderDto,
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
    private readonly customFields: CustomFieldsService,
    private readonly domainEvents: DomainEventsService,
  ) {}

  /** One tenant lock for all maintenance writers, including schedule-generated work. */
  private async locked<T>(tenantId: string, run: (service: MaintenanceService) => Promise<T>) {
    const afterCommit: Array<() => Promise<unknown>> = [];
    const audit = {
      log: async (...args: Parameters<AuditLogsService['log']>) => {
        afterCommit.push(() => this.audit.log(...args));
      },
    } as AuditLogsService;
    const events = {
      emit: async (...args: Parameters<DomainEventsService['emit']>) => {
        afterCommit.push(() => this.domainEvents.emit(...args));
      },
    } as unknown as DomainEventsService;
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
      const service = new MaintenanceService(
        tx as unknown as PrismaService,
        this.ownership,
        audit,
        this.customFields,
        events,
      );
      return run(service);
    });
    for (const effect of afterCommit) await effect();
    return result;
  }
  private checkVersion(wo: { updatedAt: Date }, expected?: string) {
    if (expected && wo.updatedAt.toISOString() !== new Date(expected).toISOString())
      throw new ConflictException('Cet ordre a changé. Actualisez le dossier avant de confirmer.');
  }
  private nextVersion(wo: { updatedAt: Date }) {
    return new Date(Math.max(Date.now(), wo.updatedAt.getTime() + 1));
  }

  create(
    tenantId: string,
    userId: string,
    dto: CreateMaintenanceOrderDto,
    scheduleId?: string | null,
  ) {
    return this.locked(tenantId, (service) =>
      service.createLocked(tenantId, userId, dto, scheduleId),
    );
  }
  start(tenantId: string, userId: string, id: string, dto: MaintenanceVersionDto = {}) {
    return this.locked(tenantId, (service) => service.startLocked(tenantId, userId, id, dto));
  }
  complete(tenantId: string, userId: string, id: string, dto: CompleteMaintenanceOrderDto) {
    return this.locked(tenantId, (service) => service.completeLocked(tenantId, userId, id, dto));
  }
  cancel(tenantId: string, userId: string, id: string, dto: MaintenanceVersionDto = {}) {
    return this.locked(tenantId, (service) => service.cancelLocked(tenantId, userId, id, dto));
  }
  update(tenantId: string, userId: string, id: string, dto: UpdateMaintenanceOrderDto) {
    return this.locked(tenantId, async (service) => {
      const wo = await service.get(tenantId, id);
      service.checkVersion(wo, dto.expectedUpdatedAt);
      if (!['OPEN', 'IN_PROGRESS'].includes(wo.status))
        throw new ConflictException('Un ordre terminé ou annulé ne peut plus être planifié.');
      const { count } = await service.prisma.maintenanceOrder.updateMany({
        where: { tenantId, id, status: wo.status, updatedAt: wo.updatedAt },
        data: {
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.vendor !== undefined ? { vendor: dto.vendor } : {}),
          ...(dto.dueDate !== undefined ? { dueDate: dto.dueDate } : {}),
          updatedAt: service.nextVersion(wo),
        },
      });
      if (!count) throw new ConflictException('Cet ordre a changé. Actualisez le dossier.');
      await service.audit.log({
        tenantId,
        userId,
        action: AuditAction.UPDATE,
        entityType: 'maintenance-order',
        entityId: id,
        before: { dueDate: wo.dueDate, vendor: wo.vendor, description: wo.description },
        after: { dueDate: dto.dueDate, vendor: dto.vendor, description: dto.description },
      });
      return service.get(tenantId, id);
    });
  }

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
    const wo = await this.prisma.maintenanceOrder.findFirst({
      where: { id, tenantId },
      include: {
        vehicle: { select: { id: true, unitNumber: true, status: true } },
        trailer: { select: { id: true, unitNumber: true, status: true } },
      },
    });
    if (!wo) throw new NotFoundException('Maintenance order not found');
    return wo;
  }

  private async createLocked(
    tenantId: string,
    userId: string,
    dto: CreateMaintenanceOrderDto,
    scheduleId?: string | null,
  ) {
    if (!!dto.vehicleId === !!dto.trailerId) {
      throw new BadRequestException('Exactly one of vehicleId or trailerId is required');
    }
    await this.ownership.assertOwnedIfSet('vehicle', dto.vehicleId, tenantId);
    await this.ownership.assertOwnedIfSet('trailer', dto.trailerId, tenantId);
    if (scheduleId) {
      const schedule = await this.prisma.maintenanceSchedule.findFirst({
        where: { id: scheduleId, tenantId },
      });
      if (
        !schedule ||
        !schedule.isActive ||
        schedule.vehicleId !== (dto.vehicleId ?? null) ||
        schedule.trailerId !== (dto.trailerId ?? null)
      )
        throw new ConflictException('Le plan est inactif ou ne correspond plus à cet actif.');
      const existing = await this.prisma.maintenanceOrder.findFirst({
        where: { tenantId, scheduleId, status: { in: ['OPEN', 'IN_PROGRESS'] } },
      });
      if (existing) return existing;
    }

    const customData = await this.customFields.validateValues(
      'fleet',
      tenantId,
      CustomFieldEntity.MAINTENANCE_ORDER,
      dto.customData,
      { partial: false },
    );
    const { customData: _cd, ...dtoWithout } = dto;

    const wo = await this.prisma.maintenanceOrder.create({
      data: {
        tenantId,
        vehicleId: dtoWithout.vehicleId ?? null,
        trailerId: dtoWithout.trailerId ?? null,
        type: dtoWithout.type,
        status: MaintenanceOrderStatus.OPEN,
        description: dtoWithout.description,
        odometerKm: dtoWithout.odometerKm ?? null,
        vendor: dtoWithout.vendor ?? null,
        dueDate: dtoWithout.dueDate ?? null,
        dueOdometerKm: dtoWithout.dueOdometerKm ?? null,
        scheduleId: scheduleId ?? null,
        openedAt: new Date(),
        createdById: userId,
        ...(customData !== undefined ? { customData: customData as Prisma.InputJsonValue } : {}),
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

  private async startLocked(
    tenantId: string,
    userId: string,
    id: string,
    dto: MaintenanceVersionDto,
  ) {
    const wo = await this.get(tenantId, id);
    this.checkVersion(wo, dto.expectedUpdatedAt);
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
      data: { status: MaintenanceOrderStatus.IN_PROGRESS, updatedAt: this.nextVersion(wo) },
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

  private async completeLocked(
    tenantId: string,
    userId: string,
    id: string,
    dto: CompleteMaintenanceOrderDto,
  ) {
    const wo = await this.get(tenantId, id);
    this.checkVersion(wo, dto.expectedUpdatedAt);
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
        updatedAt: this.nextVersion(wo),
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

    // Continuity: completing a scheduled WO advances the schedule anchor so the
    // next cycle is recomputed forward (date = now, odometer = recorded reading).
    if (wo.scheduleId) {
      await this.prisma.maintenanceSchedule.updateMany({
        where: { id: wo.scheduleId, tenantId },
        data: {
          anchorDate: new Date(),
          ...(dto.odometerKm != null ? { anchorOdometerKm: dto.odometerKm } : {}),
        },
      });
    }
    return this.get(tenantId, id);
  }

  private async cancelLocked(
    tenantId: string,
    userId: string,
    id: string,
    dto: MaintenanceVersionDto,
  ) {
    const wo = await this.get(tenantId, id);
    this.checkVersion(wo, dto.expectedUpdatedAt);
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
      data: { status: MaintenanceOrderStatus.CANCELLED, updatedAt: this.nextVersion(wo) },
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
    if (next === 'AVAILABLE') {
      // Never release an asset while another maintenance order remains active,
      // nor overwrite a state changed outside the maintenance workflow.
      if (asset.status !== 'MAINTENANCE') return;
      const remaining = await this.prisma.maintenanceOrder.count({
        where: {
          tenantId,
          ...(vehicleId ? { vehicleId } : { trailerId }),
          status: { in: ['OPEN', 'IN_PROGRESS'] },
        },
      });
      if (remaining > 0) return;
    }
    if (asset.status === next) return;
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
