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
} from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { OwnershipService } from '../../../prisma/ownership.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { SequencesService } from '../../../prisma/sequences.service';
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
      this.prisma.manufacturingOrder.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
      this.prisma.manufacturingOrder.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  async get(tenantId: string, id: string) {
    const order = await this.prisma.manufacturingOrder.findFirst({
      where: { id, tenantId },
      include: { operations: { orderBy: { sequence: 'asc' } } },
    });
    if (!order) throw new NotFoundException('Manufacturing order not found');
    return order;
  }

  async create(tenantId: string, userId: string, dto: CreateManufacturingOrderDto) {
    await this.ownership.assertOwnedIfSet('routing', dto.routingId, tenantId);
    await this.ownership.assertOwnedIfSet('bom', dto.bomId, tenantId);

    const number = await this.sequences.nextNumber(tenantId, 'manufacturing-order');

    const order = await this.prisma.manufacturingOrder.create({
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
          ? { operations: { create: dto.operations.map((op) => this.operationData(tenantId, op)) } }
          : {}),
      },
      include: { operations: { orderBy: { sequence: 'asc' } } },
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
    const res = await this.prisma.manufacturingOrder.updateMany({ where: { id, tenantId }, data });
    if (res.count === 0) throw new NotFoundException('Manufacturing order not found');

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
    await this.prisma.manufacturingOrder.deleteMany({ where: { id, tenantId } });
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
    const order = await this.get(tenantId, id);
    const current = order.status as ManufacturingOrderStatus;
    if (!canTransitionManufacturingOrder(current, target)) {
      throw new BadRequestException(`Cannot move an order from ${current} to ${target}`);
    }
    const { count } = await this.prisma.manufacturingOrder.updateMany({
      where: { id, tenantId, status: current },
      data: { status: target },
    });
    if (count === 0) {
      throw new ConflictException('Manufacturing order changed concurrently');
    }
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

  async updateOperation(
    tenantId: string,
    orderId: string,
    opId: string,
    dto: UpdateOperationDto,
  ) {
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
