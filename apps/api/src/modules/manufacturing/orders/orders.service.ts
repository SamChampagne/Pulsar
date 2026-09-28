import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  coversManufacturingPeriod,
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
        mrpPreparation: { select: { id: true, runId: true, proposalId: true } },
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
    for (const op of dto.operations ?? []) await this.checkOperationReferences(tenantId, op);

    const number = await this.sequences.nextNumber(tenantId, 'manufacturing-order');

    const order = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
      return this.createDraftInTransaction(tx, tenantId, number, dto);
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

  /** Internal writer shared by manual and MRP creation. Caller holds tenant lock,
   * validates references and audits the committed document. Always DRAFT. */
  async createDraftInTransaction(
    tx: Prisma.TransactionClient,
    tenantId: string,
    number: string,
    dto: CreateManufacturingOrderDto,
    context?: { locationId: string; bomRevisionId: string },
  ) {
    for (const op of dto.operations ?? [])
      await this.validateOperationReferences(tx, tenantId, '', op);
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
        ...context,
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
        (dto.quantity !== undefined &&
          (order.materialSnapshot || order.mrpPreparation) &&
          dto.quantity !== order.quantity) ||
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
    if (order.mrpPreparation)
      throw new ConflictException(
        'Cet OF est lié au MRP. Utilisez Annuler pour conserver sa traçabilité.',
      );
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
      if (
        order.materialSnapshot &&
        [ManufacturingOrderStatus.COMPLETED, ManufacturingOrderStatus.CANCELLED].includes(target)
      ) {
        const actuals = await tx.manufacturingDeclaration.findMany({
          where: { tenantId, orderId: id },
          include: { reversal: { select: { id: true } } },
        });
        if (target === ManufacturingOrderStatus.CANCELLED && actuals.length)
          throw new ConflictException(
            'Cet OF porte des mouvements réels; une annulation ne peut pas les effacer.',
          );
        if (
          target === ManufacturingOrderStatus.COMPLETED &&
          actuals
            .filter((d) => !d.reversal)
            .reduce((sum, d) => sum + d.goodQuantity + d.scrapQuantity, 0) !== order.quantity
        )
          throw new ConflictException(
            'Déclarez la production et les rebuts de toute la quantité avant de terminer l’OF.',
          );
      }
      if (
        target === ManufacturingOrderStatus.RELEASED &&
        (await tx.mrpPreparation.findFirst({ where: { tenantId, manufacturingOrderId: id } })) &&
        !(await tx.manufacturingOperation.count({ where: { tenantId, orderId: id } }))
      )
        throw new BadRequestException(
          'Complétez les opérations de cet OF MRP avant de le libérer.',
        );
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
          { from: order.releaseDate, until: order.dueDate },
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
    period?: { from: Date; until: Date },
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
    if (
      period &&
      !coversManufacturingPeriod(
        {
          validFrom: revision.validFrom?.toISOString(),
          validUntil: revision.validUntil?.toISOString(),
        },
        period.from.toISOString().slice(0, 10),
        period.until.toISOString().slice(0, 10),
      )
    )
      throw new BadRequestException('La version publiée ne couvre pas les dates de cet OF.');
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
      const origin = await tx.mrpPreparation.findFirst({
        where: { tenantId, manufacturingOrderId: id },
      });
      if (
        origin &&
        (dto.locationId !== order.locationId || dto.bomRevisionId !== order.bomRevisionId)
      )
        throw new ConflictException(
          'Le site et la version proviennent du MRP. Annulez cet OF puis recalculez pour les changer.',
        );
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
    await this.checkOperationReferences(tenantId, dto);
    const op = await this.editOperations(tenantId, orderId, async (tx) => {
      await this.validateOperationReferences(tx, tenantId, orderId, dto);
      return tx.manufacturingOperation.create({
        data: { ...this.operationData(tenantId, dto), orderId },
      });
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
    await this.checkOperationReferences(tenantId, dto);
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
    return this.editOperations(tenantId, orderId, async (tx) => {
      await this.validateOperationReferences(tx, tenantId, orderId, dto, opId);
      const changed = await tx.manufacturingOperation.updateMany({
        where: { id: opId, orderId, tenantId },
        data,
      });
      if (!changed.count) throw new NotFoundException('Manufacturing operation not found');
      return tx.manufacturingOperation.findFirstOrThrow({
        where: { id: opId, orderId, tenantId },
      });
    });
  }

  async removeOperation(tenantId: string, orderId: string, opId: string) {
    return this.editOperations(tenantId, orderId, async (tx) => {
      const removed = await tx.manufacturingOperation.deleteMany({
        where: { id: opId, orderId, tenantId },
      });
      if (!removed.count) throw new NotFoundException('Manufacturing operation not found');
      return { success: true };
    });
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
    await this.ownership.assertOwned('routing', routingId, tenantId);
    const seeded = await this.editOperations(tenantId, orderId, async (tx, order) => {
      if (order.status !== ManufacturingOrderStatus.DRAFT)
        throw new ConflictException('Operations can only be seeded on a DRAFT order');
      if (await tx.manufacturingOperation.count({ where: { tenantId, orderId } }))
        throw new ConflictException('Order already has operations');
      const routing = await tx.routing.findFirst({
        where: { id: routingId, tenantId },
        include: { steps: { orderBy: { sequence: 'asc' } } },
      });
      if (!routing) throw new NotFoundException('Routing not found');

      for (const step of routing.steps) {
        await this.validateOperationReferences(tx, tenantId, orderId, {
          eligibleWorkCenterIds: step.eligibleWorkCenterIds,
        });
        await tx.manufacturingOperation.create({
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
        });
      }
      return routing.steps.length;
    });

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.UPDATE,
      entityType: 'manufacturing-order',
      entityId: orderId,
      after: { seededOperations: seeded, routingId },
    });
    return this.get(tenantId, orderId);
  }

  // --- Helpers -------------------------------------------------------------

  private async editOperations<T>(
    tenantId: string,
    orderId: string,
    work: (tx: Prisma.TransactionClient, order: { status: string }) => Promise<T>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
      const order = await tx.manufacturingOrder.findFirst({ where: { tenantId, id: orderId } });
      if (!order) throw new NotFoundException('OF introuvable.');
      if (order.status !== 'DRAFT' && order.status !== 'RELEASED')
        throw new ConflictException(
          'Les opérations sont modifiables uniquement avant le démarrage de l’OF.',
        );
      const result = await work(tx, order);
      await tx.manufacturingOrder.updateMany({
        where: { tenantId, id: orderId },
        data: { updatedAt: new Date(Math.max(Date.now(), order.updatedAt.getTime() + 1)) },
      });
      return result;
    });
  }

  private async checkOperationReferences(tenantId: string, dto: UpdateOperationDto) {
    for (const id of dto.eligibleWorkCenterIds ?? [])
      await this.ownership.assertOwned('workCenter', id, tenantId);
    for (const id of dto.dependsOn ?? [])
      await this.ownership.assertOwned('manufacturingOperation', id, tenantId);
  }

  private async validateOperationReferences(
    tx: Prisma.TransactionClient,
    tenantId: string,
    orderId: string,
    dto: UpdateOperationDto,
    opId?: string,
  ) {
    const centers = [...new Set(dto.eligibleWorkCenterIds ?? [])];
    const deps = [...new Set(dto.dependsOn ?? [])];
    if (
      (await tx.workCenter.count({ where: { tenantId, id: { in: centers } } })) !==
        centers.length ||
      (opId && deps.includes(opId)) ||
      (await tx.manufacturingOperation.count({
        where: { tenantId, orderId, id: { in: deps } },
      })) !== deps.length
    )
      throw new BadRequestException('Poste ou prédécesseur incompatible avec cet OF.');
  }

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
}
