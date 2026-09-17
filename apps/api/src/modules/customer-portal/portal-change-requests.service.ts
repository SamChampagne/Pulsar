import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  DOMAIN_EVENT_TYPES,
  PortalChangeRequestKind,
  PortalChangeRequestStatus,
  canTransitionPortalChangeRequest,
} from '@pulsar/shared';
import { auditActor } from '../../core/audit-logs/audit-actor';
import { AuditLogsService } from '../../core/audit-logs/audit-logs.service';
import { DomainEventsService } from '../../core/operating/domain-events.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { PortalContext } from './portal.service';

/** What a portal user asks staff to change on one of their orders/shipments. */
export interface PortalChangeRequestInput {
  orderId?: string;
  shipmentId?: string;
  kind: PortalChangeRequestKind;
  note: string;
}

/**
 * Customer-facing row (rule 10/54): document **numbers**, never the ids of the
 * order/shipment the request hangs off, never `tenantId`/`customerId`.
 */
export interface PortalChangeRequestView {
  id: string;
  kind: PortalChangeRequestKind;
  note: string;
  status: PortalChangeRequestStatus;
  staffResponse: string | null;
  orderNumber: string | null;
  shipmentNumber: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
}

/** Staff-facing row: the customer-facing one plus who asked, for which company. */
export interface StaffChangeRequestView extends PortalChangeRequestView {
  customerName: string;
  requestedBy: string | null;
  updatedAt: Date;
}

interface ChangeRequestRow {
  id: string;
  kind: string;
  note: string;
  status: string;
  staffResponse: string | null;
  orderId: string | null;
  shipmentId: string | null;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
}

const TERMINAL_STATUSES = new Set<PortalChangeRequestStatus>([
  PortalChangeRequestStatus.RESOLVED,
  PortalChangeRequestStatus.REJECTED,
]);

/**
 * Persisted portal change requests (spec §B2.2, rule 54).
 *
 * The customer writes a row; staff answer it through the state machine
 * (`canTransitionPortalChangeRequest`, rule 2) with a conditional `updateMany`
 * claim so two operators cannot both close the same request.
 */
@Injectable()
export class PortalChangeRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly domainEvents: DomainEventsService,
  ) {}

  // --- Portal side ------------------------------------------------------------

  /**
   * Rule 54: the row is written FIRST, then the domain event announces a fact
   * that is already durable (the event carries `changeRequestId` so the
   * workbench policy can link back to it). Event and audit stay best-effort —
   * a notification failure must not lose the customer's request.
   */
  async createFor(
    ctx: PortalContext,
    dto: PortalChangeRequestInput,
  ): Promise<PortalChangeRequestView> {
    let subject: { type: string; id: string };
    let orderId: string | undefined;
    let shipmentId: string | undefined;
    let orderNumber: string | null = null;
    let shipmentNumber: string | null = null;

    if (dto.orderId) {
      const order = await this.prisma.transportOrder.findFirst({
        where: { id: dto.orderId, tenantId: ctx.tenantId, customerId: ctx.customerId },
        select: { id: true, orderNumber: true },
      });
      if (!order) throw new NotFoundException('Order not found');
      subject = { type: 'transport-order', id: order.id };
      orderId = order.id;
      orderNumber = order.orderNumber;
    } else if (dto.shipmentId) {
      const shipment = await this.prisma.shipment.findFirst({
        where: {
          id: dto.shipmentId,
          tenantId: ctx.tenantId,
          transportOrder: { customerId: ctx.customerId },
        },
        select: { id: true, shipmentNumber: true },
      });
      if (!shipment) throw new NotFoundException('Shipment not found');
      subject = { type: 'shipment', id: shipment.id };
      shipmentId = shipment.id;
      shipmentNumber = shipment.shipmentNumber;
    } else {
      throw new BadRequestException('orderId or shipmentId is required');
    }

    const row = await this.prisma.portalChangeRequest.create({
      data: {
        tenantId: ctx.tenantId,
        customerId: ctx.customerId,
        portalUserId: ctx.actor?.portalUserId ?? null,
        orderId: orderId ?? null,
        shipmentId: shipmentId ?? null,
        kind: dto.kind,
        note: dto.note,
        status: PortalChangeRequestStatus.OPEN,
      },
    });

    const bucket = new Date().toISOString().slice(0, 16);
    void this.domainEvents
      .emit(ctx.tenantId, DOMAIN_EVENT_TYPES.PORTAL_CHANGE_REQUEST, subject, {
        subject,
        changeRequestId: row.id,
        kind: dto.kind,
        note: dto.note,
        bucket,
        customerName: ctx.customerName,
        ...(orderNumber ? { orderNumber } : {}),
        ...(ctx.actor ? { portalUserId: ctx.actor.portalUserId } : {}),
      })
      .catch(() => {
        /* best-effort */
      });

    void this.audit
      .log({
        tenantId: ctx.tenantId,
        action: AuditAction.CREATE,
        entityType: 'portal-change-request',
        entityId: row.id,
        after: {
          kind: dto.kind,
          note: dto.note,
          customer: ctx.customerName,
          ...(ctx.actor ? { portalUserId: ctx.actor.portalUserId } : {}),
        },
      })
      .catch(() => {
        /* best-effort */
      });

    return this.project(row, orderNumber, shipmentNumber);
  }

  /** The customer's own request history, scoped `(tenantId, customerId)` (rule 1). */
  async listFor(ctx: PortalContext): Promise<PortalChangeRequestView[]> {
    const rows = await this.prisma.portalChangeRequest.findMany({
      where: { tenantId: ctx.tenantId, customerId: ctx.customerId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const refs = await this.resolveRefs(ctx.tenantId, rows, ctx.customerId);
    return rows.map((row) =>
      this.project(
        row,
        (row.orderId && refs.orders.get(row.orderId)) ?? null,
        (row.shipmentId && refs.shipments.get(row.shipmentId)) ?? null,
      ),
    );
  }

  // --- Staff side -------------------------------------------------------------

  async list(
    tenantId: string,
    query: { status?: PortalChangeRequestStatus } = {},
  ): Promise<StaffChangeRequestView[]> {
    const rows = await this.prisma.portalChangeRequest.findMany({
      where: { tenantId, ...(query.status ? { status: query.status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        customer: { select: { name: true } },
        portalUser: { select: { firstName: true, lastName: true, email: true } },
      },
    });
    const refs = await this.resolveRefs(tenantId, rows);
    return rows.map((row) => this.projectForStaff(row, refs));
  }

  acknowledge(tenantId: string, id: string, actorUserId: string) {
    return this.transition(tenantId, id, actorUserId, PortalChangeRequestStatus.ACKNOWLEDGED);
  }

  resolve(tenantId: string, id: string, actorUserId: string, response?: string) {
    return this.transition(tenantId, id, actorUserId, PortalChangeRequestStatus.RESOLVED, response);
  }

  reject(tenantId: string, id: string, actorUserId: string, response?: string) {
    return this.transition(tenantId, id, actorUserId, PortalChangeRequestStatus.REJECTED, response);
  }

  /**
   * One transition path: state machine first (rule 2), then a conditional
   * `updateMany` on the status we read (TOCTOU) — 0 rows means somebody else
   * moved it meanwhile, which is a 409, never a silent overwrite. Audited as a
   * STATUS_CHANGE with the staff actor (rule 6).
   */
  private async transition(
    tenantId: string,
    id: string,
    actorUserId: string,
    to: PortalChangeRequestStatus,
    response?: string,
  ): Promise<StaffChangeRequestView> {
    const current = await this.prisma.portalChangeRequest.findFirst({
      where: { id, tenantId },
      select: { id: true, status: true },
    });
    if (!current) throw new NotFoundException('Change request not found');
    const from = current.status as PortalChangeRequestStatus;
    if (!canTransitionPortalChangeRequest(from, to)) {
      throw new BadRequestException(`Cannot move a change request from ${from} to ${to}`);
    }

    const { count } = await this.prisma.portalChangeRequest.updateMany({
      where: { id, tenantId, status: from },
      data: {
        status: to,
        ...(response !== undefined ? { staffResponse: response } : {}),
        ...(TERMINAL_STATUSES.has(to) ? { resolvedAt: new Date() } : {}),
      },
    });
    if (count === 0) {
      throw new ConflictException('Change request status changed concurrently — reload and retry');
    }

    await this.audit.log({
      tenantId,
      userId: auditActor(actorUserId),
      action: AuditAction.STATUS_CHANGE,
      entityType: 'portal-change-request',
      entityId: id,
      before: { status: from },
      after: { status: to, ...(response !== undefined ? { staffResponse: response } : {}) },
    });

    return this.getForStaff(tenantId, id);
  }

  private async getForStaff(tenantId: string, id: string): Promise<StaffChangeRequestView> {
    const row = await this.prisma.portalChangeRequest.findFirst({
      where: { id, tenantId },
      include: {
        customer: { select: { name: true } },
        portalUser: { select: { firstName: true, lastName: true, email: true } },
      },
    });
    if (!row) throw new NotFoundException('Change request not found');
    const refs = await this.resolveRefs(tenantId, [row]);
    return this.projectForStaff(row, refs);
  }

  // --- Projections ------------------------------------------------------------

  /**
   * Resolves the order/shipment **numbers** referenced by the rows. `customerId`
   * narrows the lookup on the portal side so a request that somehow points
   * elsewhere resolves to `null` instead of leaking another customer's number.
   */
  private async resolveRefs(
    tenantId: string,
    rows: Array<{ orderId: string | null; shipmentId: string | null }>,
    customerId?: string,
  ): Promise<{ orders: Map<string, string>; shipments: Map<string, string> }> {
    const orderIds = [...new Set(rows.map((r) => r.orderId).filter((id): id is string => !!id))];
    const shipmentIds = [
      ...new Set(rows.map((r) => r.shipmentId).filter((id): id is string => !!id)),
    ];
    const [orders, shipments] = await Promise.all([
      orderIds.length
        ? this.prisma.transportOrder.findMany({
            where: { tenantId, id: { in: orderIds }, ...(customerId ? { customerId } : {}) },
            select: { id: true, orderNumber: true },
          })
        : Promise.resolve([]),
      shipmentIds.length
        ? this.prisma.shipment.findMany({
            where: {
              tenantId,
              id: { in: shipmentIds },
              ...(customerId ? { transportOrder: { customerId } } : {}),
            },
            select: { id: true, shipmentNumber: true },
          })
        : Promise.resolve([]),
    ]);
    return {
      orders: new Map(orders.map((o) => [o.id, o.orderNumber])),
      shipments: new Map(shipments.map((s) => [s.id, s.shipmentNumber])),
    };
  }

  private project(
    row: ChangeRequestRow,
    orderNumber: string | null,
    shipmentNumber: string | null,
  ): PortalChangeRequestView {
    return {
      id: row.id,
      kind: row.kind as PortalChangeRequestKind,
      note: row.note,
      status: row.status as PortalChangeRequestStatus,
      staffResponse: row.staffResponse,
      orderNumber,
      shipmentNumber,
      createdAt: row.createdAt,
      resolvedAt: row.resolvedAt,
    };
  }

  private projectForStaff(
    row: ChangeRequestRow & {
      customer: { name: string };
      portalUser: { firstName: string; lastName: string; email: string } | null;
    },
    refs: { orders: Map<string, string>; shipments: Map<string, string> },
  ): StaffChangeRequestView {
    const requestedBy = row.portalUser
      ? `${row.portalUser.firstName} ${row.portalUser.lastName}`.trim() || row.portalUser.email
      : null;
    return {
      ...this.project(
        row,
        (row.orderId && refs.orders.get(row.orderId)) ?? null,
        (row.shipmentId && refs.shipments.get(row.shipmentId)) ?? null,
      ),
      customerName: row.customer.name,
      requestedBy,
      updatedAt: row.updatedAt,
    };
  }
}
