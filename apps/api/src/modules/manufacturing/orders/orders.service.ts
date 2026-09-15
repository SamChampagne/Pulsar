import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  ManufacturingOperationStatus,
  ManufacturingOrderStatus,
  canTransitionManufacturingOrder,
  MODULE_KEYS,
  type ManufacturingMaterialSnapshot,
} from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { OwnershipService } from '../../../prisma/ownership.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { SequencesService } from '../../../prisma/sequences.service';
import { TenantModulesCacheService } from '../../../prisma/tenant-modules-cache.service';
import { MaterialContextDto } from './dto/material-context.dto';
import { paginated, paginationArgs } from '../../../common/pagination';
import {
  CreateManufacturingOrderDto,
  CreateOperationDto,
  ManufacturingOrderListQueryDto,
  UpdateManufacturingOrderDto,
  UpdateOperationDto,
} from './dto/order.dto';

/**
 * Manufacturing orders (the core APS resource). Numbers come from
 * SequencesService (rule 8); orders are born DRAFT and the status moves ONLY
 * through canTransitionManufacturingOrder (rule 2) with a conditional updateMany
 * claim (TOCTOU) + before/after audit (rule 6). Tenant-scoped (rule 1);
 * routingId/bomId FKs are ownership-checked (rule 9).
 */
@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly sequences: SequencesService,
    private readonly audit: AuditLogsService,
    private readonly modules: TenantModulesCacheService,
  ) {}

  async list(tenantId: string, query: ManufacturingOrderListQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where: Prisma.ManufacturingOrderWhereInput = {
      tenantId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { number: { contains: query.search, mode: 'insensitive' } },
              { name: { contains: query.search, mode: 'insensitive' } },
              { productRef: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.manufacturingOrder.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.manufacturingOrder.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  async get(tenantId: string, id: string) {
    const order = await this.prisma.manufacturingOrder.findFirst({
      where: { id, tenantId },
      include: {
        operations: { where: { tenantId }, orderBy: { sequence: 'asc' } },
        location: { select: { id: true, code: true, name: true } },
        bomRevision: { include: { lines: { where: { tenantId } } } },
      },
    });
    if (!order) throw new NotFoundException('Manufacturing order not found');
    return order;
  }

  async create(tenantId: string, userId: string, dto: CreateManufacturingOrderDto) {
    await this.ownership.assertOwnedIfSet('routing', dto.routingId, tenantId);
    await this.ownership.assertOwnedIfSet('bom', dto.bomId, tenantId);

    const number = await this.sequences.nextNumber(tenantId, 'manufacturing-order');

    const order = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
      return tx.manufacturingOrder.create({
        data: {
          tenantId,
          number,
          name: dto.name,
          productRef: dto.productRef,
          quantity: dto.quantity ?? 1,
          dueDate: new Date(dto.dueDate),
          releaseDate: new Date(dto.releaseDate),
          ...(dto.priority ? { priority: dto.priority } : {}),
          status: ManufacturingOrderStatus.DRAFT,
          ...(dto.firmness ? { firmness: dto.firmness } : {}),
          routingId: dto.routingId ?? null,
          bomId: dto.bomId ?? null,
          ...(dto.operations && dto.operations.length
            ? {
                operations: {
                  create: dto.operations.map((op) => this.operationData(tenantId, op)),
                },
              }
            : {}),
        },
        include: { operations: { orderBy: { sequence: 'asc' } } },
      });
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.CREATE,
      entityType: 'manufacturing-order',
      entityId: order.id,
      after: { number: order.number, name: order.name, status: order.status },
    });
    return order;
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdateManufacturingOrderDto) {
    const order = await this.get(tenantId, id);
    if (
      order.status !== ManufacturingOrderStatus.DRAFT &&
      order.status !== ManufacturingOrderStatus.RELEASED
    ) {
      throw new BadRequestException(`Cannot edit an order in status ${order.status}`);
    }
    await this.ownership.assertOwnedIfSet('routing', dto.routingId, tenantId);
    await this.ownership.assertOwnedIfSet('bom', dto.bomId, tenantId);

    const data: Prisma.ManufacturingOrderUpdateInput = {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.productRef !== undefined ? { productRef: dto.productRef } : {}),
      ...(dto.quantity !== undefined ? { quantity: dto.quantity } : {}),
      ...(dto.dueDate !== undefined ? { dueDate: new Date(dto.dueDate) } : {}),
      ...(dto.releaseDate !== undefined ? { releaseDate: new Date(dto.releaseDate) } : {}),
      ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
      ...(dto.firmness !== undefined ? { firmness: dto.firmness } : {}),
      ...(dto.routingId !== undefined ? { routingId: dto.routingId } : {}),
      ...(dto.bomId !== undefined ? { bomId: dto.bomId } : {}),
    };
    if (
      (order.materialSnapshot || order.bomRevisionId) &&
      ((dto.productRef !== undefined && dto.productRef !== order.productRef) ||
        (dto.quantity !== undefined && order.materialSnapshot && dto.quantity !== order.quantity) ||
        (dto.bomId !== undefined && dto.bomId !== order.bomId))
    )
      throw new ConflictException(
        'Le produit et la nomenclature sont liés à une version; les quantités sont figées après libération. Créez un nouvel OF si nécessaire.',
      );
    const res = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
      return tx.manufacturingOrder.updateMany({
        where: { id, tenantId, status: order.status, updatedAt: order.updatedAt },
        data: { ...data, updatedAt: new Date(Math.max(Date.now(), order.updatedAt.getTime() + 1)) },
      });
    });
    if (res.count === 0) throw new ConflictException('OF modifié simultanément. Rechargez.');

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.UPDATE,
      entityType: 'manufacturing-order',
      entityId: id,
      before: { name: order.name },
      after: { name: dto.name ?? order.name },
    });
    return this.get(tenantId, id);
  }

  async remove(tenantId: string, id: string) {
    const order = await this.get(tenantId, id);
    if (order.status !== ManufacturingOrderStatus.DRAFT) {
      throw new ConflictException('Only DRAFT manufacturing orders can be deleted');
    }
    const deleted = await this.prisma.manufacturingOrder.deleteMany({
      where: { id, tenantId, status: order.status, updatedAt: order.updatedAt },
    });
    if (!deleted.count) throw new ConflictException('OF modifié simultanément.');
    return { success: true };
  }

  // --- Lifecycle -----------------------------------------------------------

  release(tenantId: string, userId: string, id: string) {
    return this.transition(tenantId, userId, id, ManufacturingOrderStatus.RELEASED);
  }

  start(tenantId: string, userId: string, id: string) {
    return this.transition(tenantId, userId, id, ManufacturingOrderStatus.IN_PROGRESS);
  }

  complete(tenantId: string, userId: string, id: string) {
    return this.transition(tenantId, userId, id, ManufacturingOrderStatus.COMPLETED);
  }

  cancel(tenantId: string, userId: string, id: string) {
    return this.transition(tenantId, userId, id, ManufacturingOrderStatus.CANCELLED);
  }

  private async transition(
    tenantId: string,
    userId: string,
    id: string,
    target: ManufacturingOrderStatus,
  ) {
    const current = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
      const order = await tx.manufacturingOrder.findFirst({ where: { id, tenantId } });
      if (!order) throw new NotFoundException('OF introuvable.');
      const current = order.status as ManufacturingOrderStatus;
      if (!canTransitionManufacturingOrder(current, target))
        throw new BadRequestException(`Cannot move an order from ${current} to ${target}`);
      let materialSnapshot: Prisma.InputJsonValue | undefined;
      if (target === ManufacturingOrderStatus.RELEASED && order.bomId) {
        if (!order.locationId || !order.bomRevisionId)
          throw new BadRequestException(
            'Choisissez un site et une version publiée avant de libérer cet OF.',
          );
        const snapshot = await this.materials(
          tx,
          tenantId,
          order.locationId,
          order.bomRevisionId,
          order.productRef,
          order.quantity,
        );
        if (snapshot.revisionId !== order.bomRevisionId)
          throw new ConflictException('Version incompatible.');
        materialSnapshot = JSON.parse(JSON.stringify(snapshot));
      }
      const { count } = await tx.manufacturingOrder.updateMany({
        where: { id, tenantId, status: current, updatedAt: order.updatedAt },
        data: {
          status: target,
          materialSnapshot,
          updatedAt: new Date(Math.max(Date.now(), order.updatedAt.getTime() + 1)),
        },
      });
      if (!count) throw new ConflictException('Manufacturing order changed concurrently');
      return current;
    });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'manufacturing-order',
      entityId: id,
      before: { status: current },
      after: { status: target },
    });
    return this.get(tenantId, id);
  }

  private async materials(
    tx: Prisma.TransactionClient,
    tenantId: string,
    locationId: string,
    revisionId: string,
    productRef: string | null,
    quantity: number,
  ): Promise<ManufacturingMaterialSnapshot> {
    const site = await tx.location.findFirst({
      where: { id: locationId, tenantId, type: 'WAREHOUSE', isActive: true },
    });
    const revision = await tx.bomRevision.findFirst({
      where: { id: revisionId, tenantId },
      include: { lines: { where: { tenantId }, orderBy: { id: 'asc' } } },
    });
    if (!site || !revision || revision.outputSku !== productRef || !revision.lines.length)
      throw new BadRequestException('Site, version ou produit incompatible.');
    const items = await tx.wmsItem.findMany({
      where: {
        tenantId,
        isActive: true,
        id: { in: [revision.outputItemId, ...revision.lines.map((l) => l.itemId)] },
      },
    });
    const byId = new Map(items.map((item) => [item.id, item]));
    if (
      byId.get(revision.outputItemId)?.unit !== revision.outputUnit ||
      revision.lines.some((l) => byId.get(l.itemId)?.unit !== l.unit)
    )
      throw new BadRequestException('Article inactif ou unité différente de la version publiée.');
    if (!Number.isFinite(quantity) || quantity <= 0)
      throw new BadRequestException('Quantité positive requise.');
    return {
      version: 'pulsar.manufacturing.materials.v1',
      revisionId,
      revision: revision.revision,
      contentHash: revision.contentHash,
      locationId,
      capturedAt: new Date().toISOString(),
      product: {
        itemId: revision.outputItemId,
        sku: revision.outputSku,
        name: revision.outputName,
        unit: revision.outputUnit,
        quantity: new Prisma.Decimal(quantity).toFixed(),
      },
      components: revision.lines.map((line) => ({
        itemId: line.itemId,
        sku: line.sku,
        name: line.name,
        unit: line.unit,
        quantityPerUnit: line.quantityPerUnit.toFixed(),
        requiredQuantity: line.quantityPerUnit.mul(quantity).toFixed(),
      })),
    };
  }

  async setMaterialContext(tenantId: string, userId: string, id: string, dto: MaterialContextDto) {
    const enabled = await this.modules.getEnabledKeys(tenantId);
    if (!enabled.has(MODULE_KEYS.WMS))
      throw new BadRequestException('WMS requis pour configurer les matières.');
    await this.ownership.assertOwned('location', dto.locationId, tenantId);
    await this.ownership.assertOwned('bomRevision', dto.bomRevisionId, tenantId);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
      const order = await tx.manufacturingOrder.findFirst({ where: { id, tenantId } });
      if (!order) throw new NotFoundException('OF introuvable.');
      if (
        order.status !== ManufacturingOrderStatus.DRAFT ||
        order.materialSnapshot ||
        order.updatedAt.getTime() !== new Date(dto.expectedUpdatedAt).getTime()
      )
        throw new ConflictException('Seul un brouillon à jour peut changer de contexte matières.');
      await this.materials(
        tx,
        tenantId,
        dto.locationId,
        dto.bomRevisionId,
        order.productRef,
        order.quantity,
      );
      const revision = await tx.bomRevision.findFirst({
        where: { tenantId, id: dto.bomRevisionId, bom: { tenantId, isActive: true } },
      });
      if (!revision)
        throw new BadRequestException('Nomenclature inactive ou version indisponible.');
      const changed = await tx.manufacturingOrder.updateMany({
        where: { id, tenantId, updatedAt: order.updatedAt, status: order.status },
        data: {
          locationId: dto.locationId,
          bomId: revision.bomId,
          bomRevisionId: revision.id,
          updatedAt: new Date(Math.max(Date.now(), order.updatedAt.getTime() + 1)),
        },
      });
      if (!changed.count) throw new ConflictException('OF modifié simultanément.');
    });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.UPDATE,
      entityType: 'manufacturing-order',
      entityId: id,
      after: { locationId: dto.locationId, bomRevisionId: dto.bomRevisionId },
    });
    return this.get(tenantId, id);
  }

  // --- Operations sub-resource --------------------------------------------

  async addOperation(tenantId: string, userId: string, orderId: string, dto: CreateOperationDto) {
    const order = await this.get(tenantId, orderId);
    if (
      order.status === ManufacturingOrderStatus.COMPLETED ||
      order.status === ManufacturingOrderStatus.CANCELLED
    ) {
      throw new BadRequestException(
        `Cannot add an operation to an order in status ${order.status}`,
      );
    }
    const op = await this.prisma.manufacturingOperation.create({
      data: { ...this.operationData(tenantId, dto), orderId },
    });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.CREATE,
      entityType: 'manufacturing-operation',
      entityId: op.id,
      after: { orderId, sequence: op.sequence, name: op.name },
    });
    return op;
  }

  async updateOperation(tenantId: string, orderId: string, opId: string, dto: UpdateOperationDto) {
    await this.assertOperationOwned(tenantId, orderId, opId);
    const data: Prisma.ManufacturingOperationUpdateInput = {
      ...(dto.sequence !== undefined ? { sequence: dto.sequence } : {}),
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.durationMinutes !== undefined ? { durationMinutes: dto.durationMinutes } : {}),
      ...(dto.setupMinutes !== undefined ? { setupMinutes: dto.setupMinutes } : {}),
      ...(dto.eligibleWorkCenterIds !== undefined
        ? { eligibleWorkCenterIds: dto.eligibleWorkCenterIds }
        : {}),
      ...(dto.dependsOn !== undefined ? { dependsOn: dto.dependsOn } : {}),
    };
    await this.prisma.manufacturingOperation.updateMany({
      where: { id: opId, orderId, tenantId },
      data,
    });
    return this.prisma.manufacturingOperation.findFirstOrThrow({
      where: { id: opId, orderId, tenantId },
    });
  }

  async removeOperation(tenantId: string, orderId: string, opId: string) {
    await this.assertOperationOwned(tenantId, orderId, opId);
    await this.prisma.manufacturingOperation.deleteMany({
      where: { id: opId, orderId, tenantId },
    });
    return { success: true };
  }

  /**
   * Seed an order's operations from a routing's steps (rule 9: routing ownership
   * checked). Refuses if the order already has operations or is not DRAFT; the
   * copy is transactional.
   */
  async operationsFromRouting(
    tenantId: string,
    userId: string,
    orderId: string,
    routingId: string,
  ) {
    const order = await this.get(tenantId, orderId);
    if (order.status !== ManufacturingOrderStatus.DRAFT) {
      throw new ConflictException('Operations can only be seeded on a DRAFT order');
    }
    if (order.operations.length > 0) {
      throw new ConflictException('Order already has operations');
    }
    await this.ownership.assertOwned('routing', routingId, tenantId);
    const routing = await this.prisma.routing.findFirst({
      where: { id: routingId, tenantId },
      include: { steps: { orderBy: { sequence: 'asc' } } },
    });
    if (!routing) throw new NotFoundException('Routing not found');

    await this.prisma.$transaction(
      routing.steps.map((step) =>
        this.prisma.manufacturingOperation.create({
          data: {
            tenantId,
            orderId,
            sequence: step.sequence,
            name: step.name,
            durationMinutes: step.durationMinutes,
            setupMinutes: step.setupMinutes,
            eligibleWorkCenterIds: step.eligibleWorkCenterIds,
            status: ManufacturingOperationStatus.PENDING,
          },
        }),
      ),
    );

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.UPDATE,
      entityType: 'manufacturing-order',
      entityId: orderId,
      after: { seededOperations: routing.steps.length, routingId },
    });
    return this.get(tenantId, orderId);
  }

  // --- Helpers -------------------------------------------------------------

  private operationData(tenantId: string, dto: CreateOperationDto) {
    return {
      tenantId,
      sequence: dto.sequence,
      name: dto.name,
      durationMinutes: dto.durationMinutes,
      setupMinutes: dto.setupMinutes ?? 0,
      eligibleWorkCenterIds: dto.eligibleWorkCenterIds ?? [],
      dependsOn: dto.dependsOn ?? [],
      status: ManufacturingOperationStatus.PENDING,
    };
  }

  private async assertOperationOwned(tenantId: string, orderId: string, opId: string) {
    const op = await this.prisma.manufacturingOperation.findFirst({
      where: { id: opId, orderId, tenantId },
    });
    if (!op) throw new NotFoundException('Manufacturing operation not found');
    return op;
  }
}
