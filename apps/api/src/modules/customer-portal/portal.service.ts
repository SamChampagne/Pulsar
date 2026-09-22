import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@pulsar/database';
import type { PortalAuthUser } from '@pulsar/shared';
import {
  AuditAction,
  CustomerInvoiceStatus,
  MODULE_KEYS,
  ShipmentStatus,
  TransportMode,
  TransportOrderStatus,
} from '@pulsar/shared';
import { randomBytes } from 'node:crypto';
import { ListQueryDto } from '../../common/dto/list-query.dto';
import { paginated, paginationArgs } from '../../common/pagination';
import { OwnershipService } from '../../prisma/ownership.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SequencesService } from '../../prisma/sequences.service';
import { TenantModulesCacheService } from '../../prisma/tenant-modules-cache.service';
import { AuditLogsService } from '../../core/audit-logs/audit-logs.service';
import { DocumentsService } from '../../core/documents/documents.service';
import {
  buildShipmentTrackingView,
  lastPositionsByLoad,
} from '../transportation/public/shipment-tracking.view';
import { toDate, assertWindowCoherence } from '../transportation/planning/window-validation';

export interface PortalOrderInput {
  originLocationId?: string;
  destinationLocationId?: string;
  customerReference?: string;
  requestedPickupEarly?: string;
  requestedPickupLate?: string;
  requestedDeliveryEarly?: string;
  requestedDeliveryLate?: string;
  totalWeightKg?: number;
  palletCount?: number;
  notes?: string;
  mode?: TransportMode;
  templateId?: string;
}

export interface CreateOrderTemplateInput {
  name: string;
  originLocationId?: string;
  destinationLocationId?: string;
  mode?: TransportMode;
  totalWeightKg?: number;
  totalVolumeM3?: number;
  palletCount?: number;
  notes?: string;
}

/**
 * Who the portal is acting for, whatever the door they came through.
 *
 * Two doors resolve to the same context: the revocable capability link
 * (`/public/portal/:token`, no `actor`) and an authenticated portal account
 * (`/portal/*`, `actor` set). Every business method is written against this
 * context, so the two surfaces can never drift apart — and both stay scoped by
 * `tenantId` AND `customerId` (rule 1: a customer company is the isolation unit
 * inside a tenant).
 */
export interface PortalContext {
  tenantId: string;
  customerId: string;
  customerName: string;
  tenantName: string;
  /** Free-form tenant settings JSON; only `branding` is ever projected out of it. */
  settings: unknown;
  /** Set only for a session (account) caller — a shared link has no named author. */
  actor?: { portalUserId: string; displayName: string };
}

/** Public/internal-safe projection of a shipment comment (rule 10: never tenantId/authorId). */
export interface ShipmentCommentView {
  id: string;
  authorType: 'CUSTOMER' | 'STAFF';
  authorName: string;
  body: string;
  createdAt: Date;
}

/**
 * Single source of truth for the comment projection used by BOTH the public portal
 * and the internal shipments surface — never leaks tenantId, authorId or shipmentId.
 */
export function projectShipmentComment(comment: {
  id: string;
  authorType: string;
  authorName: string;
  body: string;
  createdAt: Date;
}): ShipmentCommentView {
  return {
    id: comment.id,
    authorType: comment.authorType as 'CUSTOMER' | 'STAFF',
    authorName: comment.authorName,
    body: comment.body,
    createdAt: comment.createdAt,
  };
}

/**
 * Order-template row as exposed to the portal: location **codes**, never PKs
 * (rule 10). `OrderTemplate` holds soft FKs (no Prisma relation to `Location`),
 * so the codes are resolved by the caller and handed over as a map.
 */
function projectTemplate(
  template: {
    id: string;
    name: string;
    originLocationId: string | null;
    destinationLocationId: string | null;
    mode: string | null;
    totalWeightKg: number | null;
    totalVolumeM3: number | null;
    palletCount: number | null;
    notes: string | null;
    createdAt: Date;
  },
  codes: Map<string, string>,
) {
  return {
    id: template.id,
    name: template.name,
    originCode: (template.originLocationId && codes.get(template.originLocationId)) || null,
    destinationCode:
      (template.destinationLocationId && codes.get(template.destinationLocationId)) || null,
    mode: template.mode,
    totalWeightKg: template.totalWeightKg,
    totalVolumeM3: template.totalVolumeM3,
    palletCount: template.palletCount,
    notes: template.notes,
    createdAt: template.createdAt,
  };
}

/** Amounts leave the API as numbers, never as serialized `Decimal` strings. */
function amount(value: Prisma.Decimal | number | null | undefined): number {
  return value === null || value === undefined ? 0 : Number(value);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * A live position is only published while the shipment is actually moving
 * (rule 20 + spec §B2.2) — one point, no history, never after delivery.
 */
/** A customer never sees a DRAFT statement - only what has been approved. */
const PORTAL_VISIBLE_INVOICE_STATUSES = [
  CustomerInvoiceStatus.APPROVED,
  CustomerInvoiceStatus.SENT,
  CustomerInvoiceStatus.PAID,
];

const POSITION_STATUSES = new Set<string>([ShipmentStatus.DISPATCHED, ShipmentStatus.IN_TRANSIT]);

/**
 * The order rows the portal is allowed to see. Explicit select (rule 10): no
 * `tenantId`, no carrier, no cost, no internal location PK — `loadId` and
 * `trackingToken` are read for derived fields and dropped by the projection.
 */
const portalOrderSelect = {
  id: true,
  orderNumber: true,
  customerReference: true,
  status: true,
  mode: true,
  totalWeightKg: true,
  totalVolumeM3: true,
  palletCount: true,
  notes: true,
  requestedPickupEarly: true,
  requestedPickupLate: true,
  requestedDeliveryEarly: true,
  requestedDeliveryLate: true,
  createdAt: true,
  updatedAt: true,
  originLocation: { select: { city: true, state: true } },
  destinationLocation: { select: { city: true, state: true } },
  shipments: {
    orderBy: { shipmentNumber: 'asc' },
    select: {
      id: true,
      shipmentNumber: true,
      status: true,
      loadId: true,
      trackingToken: true,
      plannedPickupEarly: true,
      plannedPickupLate: true,
      plannedDeliveryEarly: true,
      plannedDeliveryLate: true,
      actualPickupAt: true,
      actualDeliveryAt: true,
      weightKg: true,
      palletCount: true,
      proofOfDelivery: { select: { id: true } },
    },
  },
} satisfies Prisma.TransportOrderSelect;

type PortalOrderRow = Prisma.TransportOrderGetPayload<{ select: typeof portalOrderSelect }>;

/**
 * Customer Portal: visibility and self-service for the shipper's customers.
 *
 * Two authentication doors, one behaviour (see `PortalContext`):
 *  - the revocable capability link (`/public/portal/:token`), same security
 *    model as tender/tracking/driver links (docs/collaboration.md);
 *  - a named portal account (`/portal/*`, PortalGuard).
 * The `x(token, …)` methods only resolve a context and delegate to `xFor(ctx, …)`.
 */
@Injectable()
export class PortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modulesCache: TenantModulesCacheService,
    private readonly ownership: OwnershipService,
    private readonly sequences: SequencesService,
    private readonly audit: AuditLogsService,
    private readonly config: ConfigService,
    private readonly documents: DocumentsService,
  ) {}

  /**
   * Resolves + gates a portal token (module must be enabled for the tenant).
   * Public because the sibling change-requests surface resolves the same context
   * for its own token routes — there is exactly one door resolver.
   */
  async contextFromToken(token: string): Promise<PortalContext> {
    const customer = await this.prisma.customer.findUnique({
      where: { portalToken: token },
      include: { tenant: { select: { name: true, settings: true } } },
    });
    if (!customer) throw new NotFoundException('Unknown portal link');
    const enabled = await this.modulesCache.getEnabledKeys(customer.tenantId);
    if (!enabled.has(MODULE_KEYS.CUSTOMER_PORTAL)) {
      throw new ForbiddenException('The customer portal is not enabled for this shipper');
    }
    // No actor: a capability link is bearer-authenticated, nobody is named.
    return {
      tenantId: customer.tenantId,
      customerId: customer.id,
      customerName: customer.name,
      tenantName: customer.tenant.name,
      settings: customer.tenant.settings,
    };
  }

  /**
   * Resolves the context of an authenticated portal account. PortalGuard has
   * already re-read the account, the customer company and the module activation
   * on this very request; the lookup here is defensive (and loads the shipper
   * name / branding the payloads need).
   */
  async contextFromPortalUser(user: PortalAuthUser): Promise<PortalContext> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: user.customerId, tenantId: user.tenantId, isActive: true },
      select: { id: true, name: true, tenant: { select: { name: true, settings: true } } },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return {
      tenantId: user.tenantId,
      customerId: customer.id,
      customerName: customer.name,
      tenantName: customer.tenant.name,
      settings: customer.tenant.settings,
      actor: {
        portalUserId: user.id,
        displayName: `${user.firstName} ${user.lastName}`.trim() || user.email,
      },
    };
  }

  /** Audit payload fragment naming the portal account behind the action, when there is one. */
  private actorTrace(ctx: PortalContext): Record<string, string> {
    return ctx.actor ? { portalUserId: ctx.actor.portalUserId } : {};
  }

  /** Resolves an opaque location code (exposed in the public payload) to its internal PK. */
  private async resolveLocationCode(tenantId: string, code: string): Promise<string> {
    const loc = await this.prisma.location.findFirst({
      where: { tenantId, code },
      select: { id: true },
    });
    if (!loc) throw new NotFoundException(`Location not found: ${code}`);
    return loc.id;
  }

  /**
   * Portal v2: the customer submits a transport request, landing as a DRAFT
   * order for the shipper's customer service to confirm (or cancel).
   */
  createOrder(token: string, input: PortalOrderInput) {
    return this.contextFromToken(token).then((ctx) => this.createOrderFor(ctx, input));
  }

  async createOrderFor(ctx: PortalContext, input: PortalOrderInput) {
    // Resolve opaque location codes (from the public payload) to internal PKs before merging.
    const resolvedOriginId = input.originLocationId
      ? await this.resolveLocationCode(ctx.tenantId, input.originLocationId)
      : undefined;
    const resolvedDestinationId = input.destinationLocationId
      ? await this.resolveLocationCode(ctx.tenantId, input.destinationLocationId)
      : undefined;

    let mergedInput = {
      ...input,
      originLocationId: resolvedOriginId,
      destinationLocationId: resolvedDestinationId,
    };
    if (input.templateId) {
      const tpl = await this.prisma.orderTemplate.findFirst({
        where: { id: input.templateId, tenantId: ctx.tenantId, customerId: ctx.customerId },
      });
      if (!tpl) throw new NotFoundException('Template not found');
      mergedInput = {
        ...mergedInput,
        originLocationId: resolvedOriginId ?? tpl.originLocationId ?? undefined,
        destinationLocationId: resolvedDestinationId ?? tpl.destinationLocationId ?? undefined,
        mode: input.mode ?? (tpl.mode as TransportMode | undefined) ?? undefined,
        totalWeightKg: input.totalWeightKg ?? tpl.totalWeightKg ?? undefined,
        palletCount: input.palletCount ?? tpl.palletCount ?? undefined,
        notes: input.notes ?? tpl.notes ?? undefined,
      };
    }

    if (!mergedInput.originLocationId || !mergedInput.destinationLocationId) {
      throw new BadRequestException(
        'origin/destination requis (fournir directement ou via un template)',
      );
    }

    await Promise.all([
      this.ownership.assertOwned('location', mergedInput.originLocationId, ctx.tenantId),
      this.ownership.assertOwned('location', mergedInput.destinationLocationId, ctx.tenantId),
    ]);

    const pickupEarly = toDate(mergedInput.requestedPickupEarly);
    const pickupLate = toDate(mergedInput.requestedPickupLate);
    const deliveryEarly = toDate(mergedInput.requestedDeliveryEarly);
    const deliveryLate = toDate(mergedInput.requestedDeliveryLate);
    assertWindowCoherence({ pickupEarly, pickupLate, deliveryEarly, deliveryLate });

    const order = await this.prisma.transportOrder.create({
      data: {
        tenantId: ctx.tenantId,
        orderNumber: await this.sequences.nextNumber(ctx.tenantId, 'transport-order'),
        customerId: ctx.customerId,
        customerReference: mergedInput.customerReference,
        originLocationId: mergedInput.originLocationId!,
        destinationLocationId: mergedInput.destinationLocationId!,
        requestedPickupEarly: pickupEarly,
        requestedPickupLate: pickupLate,
        requestedDeliveryEarly: deliveryEarly,
        requestedDeliveryLate: deliveryLate,
        totalWeightKg: mergedInput.totalWeightKg,
        palletCount: mergedInput.palletCount,
        notes: mergedInput.notes,
        ...(mergedInput.mode ? { mode: mergedInput.mode } : {}),
        // No createdById: the author is the customer via the portal, not a tenant user.
        // A PortalUser id is not a User row either — it goes in the audit payload.
      },
    });
    await this.audit.log({
      tenantId: ctx.tenantId,
      action: AuditAction.CREATE,
      entityType: 'transport-order',
      entityId: order.id,
      after: {
        orderNumber: order.orderNumber,
        source: 'customer-portal',
        customerId: ctx.customerId,
        ...this.actorTrace(ctx),
      },
    });
    return {
      orderNumber: order.orderNumber,
      status: order.status,
      createdAt: order.createdAt,
    };
  }

  async generateLink(tenantId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    let token = customer.portalToken;
    if (!token) {
      token = randomBytes(24).toString('base64url');
      await this.prisma.customer.update({
        where: { id: customerId },
        data: { portalToken: token },
      });
    }
    return { url: `${this.config.get('WEB_URL', 'http://localhost:5173')}/portal/${token}` };
  }

  async revokeLink(tenantId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    await this.prisma.customer.update({
      where: { id: customerId },
      data: { portalToken: null },
    });
    return { revoked: true };
  }

  /** Public read. The module gate must be enforced here — public routes bypass ModulesGuard. */
  getPortalView(token: string) {
    return this.contextFromToken(token).then((ctx) => this.getPortalViewFor(ctx));
  }

  async getPortalViewFor(ctx: PortalContext) {
    const orders = await this.prisma.transportOrder.findMany({
      where: { tenantId: ctx.tenantId, customerId: ctx.customerId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: portalOrderSelect,
    });

    // Locations are exposed minimally (code/name/city) - opaque code instead of PK (rule 10).
    const locations = await this.prisma.location.findMany({
      where: { tenantId: ctx.tenantId, isActive: true },
      orderBy: { name: 'asc' },
      take: 100,
      select: { code: true, name: true, city: true },
    });

    const branding =
      ((ctx.settings as Record<string, unknown>)?.branding as Record<string, unknown>) ?? {};
    return {
      shipper: ctx.tenantName,
      customer: ctx.customerName,
      branding,
      locations,
      orders: await this.projectOrders(ctx, orders),
    };
  }

  listOrders(token: string, query: ListQueryDto & { status?: TransportOrderStatus }) {
    return this.contextFromToken(token).then((ctx) => this.listOrdersFor(ctx, query));
  }

  /**
   * Paginated order list for the portal workspace - same projection as the
   * dashboard `view`, scoped `(tenantId, customerId)` (rule 1 + rule 54).
   */
  async listOrdersFor(ctx: PortalContext, query: ListQueryDto & { status?: TransportOrderStatus }) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where: Prisma.TransportOrderWhereInput = {
      tenantId: ctx.tenantId,
      customerId: ctx.customerId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { orderNumber: { contains: query.search, mode: 'insensitive' } },
              { customerReference: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.transportOrder.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: portalOrderSelect,
      }),
      this.prisma.transportOrder.count({ where }),
    ]);
    return paginated(await this.projectOrders(ctx, rows), total, page, pageSize);
  }

  /**
   * Builds the customer-facing order rows: drops every internal reference
   * (`loadId`, `trackingToken`, POD id) and derives the three fields the portal
   * needs - document count, POD presence and the single live position.
   *
   * Batched on purpose: two extra queries whatever the number of orders.
   */
  private async projectOrders(ctx: PortalContext, orders: PortalOrderRow[]) {
    const shipments = orders.flatMap((order) => order.shipments);
    const shipmentIds = shipments.map((shipment) => shipment.id);
    const movingLoadIds = shipments
      .filter((shipment) => POSITION_STATUSES.has(shipment.status))
      .map((shipment) => shipment.loadId);

    const [documentCounts, positions] = await Promise.all([
      shipmentIds.length
        ? this.prisma.document.groupBy({
            by: ['entityId'],
            where: {
              tenantId: ctx.tenantId,
              entityType: 'proof-of-delivery',
              entityId: { in: shipmentIds },
            },
            _count: { _all: true },
          })
        : Promise.resolve([] as Array<{ entityId: string; _count: { _all: number } }>),
      lastPositionsByLoad(this.prisma, ctx.tenantId, movingLoadIds),
    ]);
    const counts = new Map(documentCounts.map((row) => [row.entityId, row._count._all]));
    const webUrl = this.config.get('WEB_URL', 'http://localhost:5173');

    return orders.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      customerReference: order.customerReference,
      status: order.status,
      mode: order.mode,
      totalWeightKg: order.totalWeightKg,
      totalVolumeM3: order.totalVolumeM3,
      palletCount: order.palletCount,
      notes: order.notes,
      requestedPickupEarly: order.requestedPickupEarly,
      requestedPickupLate: order.requestedPickupLate,
      requestedDeliveryEarly: order.requestedDeliveryEarly,
      requestedDeliveryLate: order.requestedDeliveryLate,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      originLocation: order.originLocation,
      destinationLocation: order.destinationLocation,
      shipments: order.shipments.map((shipment) => {
        const position =
          shipment.loadId && POSITION_STATUSES.has(shipment.status)
            ? (positions.get(shipment.loadId) ?? null)
            : null;
        return {
          id: shipment.id,
          shipmentNumber: shipment.shipmentNumber,
          status: shipment.status,
          plannedPickupEarly: shipment.plannedPickupEarly,
          plannedPickupLate: shipment.plannedPickupLate,
          plannedDeliveryEarly: shipment.plannedDeliveryEarly,
          plannedDeliveryLate: shipment.plannedDeliveryLate,
          actualPickupAt: shipment.actualPickupAt,
          actualDeliveryAt: shipment.actualDeliveryAt,
          weightKg: shipment.weightKg,
          palletCount: shipment.palletCount,
          documentCount: counts.get(shipment.id) ?? 0,
          hasPod: shipment.proofOfDelivery !== null,
          lastPosition: position
            ? {
                latitude: position.latitude,
                longitude: position.longitude,
                recordedAt: position.occurredAt,
              }
            : null,
          trackingUrl: shipment.trackingToken ? `${webUrl}/track/${shipment.trackingToken}` : null,
        };
      }),
    }));
  }

  getShipmentTracking(token: string, shipmentId: string) {
    return this.contextFromToken(token).then((ctx) => this.getShipmentTrackingFor(ctx, shipmentId));
  }

  /**
   * Same payload as the public tracking page, reached through the portal:
   * ownership first (the shipment must hang off one of this customer's orders),
   * then the one shared projection.
   */
  async getShipmentTrackingFor(ctx: PortalContext, shipmentId: string) {
    await this.customerShipment(ctx.tenantId, ctx.customerId, shipmentId);
    return buildShipmentTrackingView(
      this.prisma,
      { id: shipmentId, tenantId: ctx.tenantId },
      'Shipment not found',
    );
  }

  listInvoices(token: string) {
    return this.contextFromToken(token).then((ctx) => this.listInvoicesFor(ctx));
  }

  async listInvoicesFor(ctx: PortalContext) {
    const enabled = await this.modulesCache.getEnabledKeys(ctx.tenantId);
    if (!enabled.has(MODULE_KEYS.BILLING)) return [];
    const invoices = await this.prisma.customerInvoice.findMany({
      where: {
        tenantId: ctx.tenantId,
        customerId: ctx.customerId,
        status: { in: PORTAL_VISIBLE_INVOICE_STATUSES },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        currency: true,
        totalAmount: true,
        amountPaid: true,
        taxAmount: true,
        approvedAt: true,
        sentAt: true,
        paidAt: true,
      },
    });
    return invoices.map((invoice) => {
      const total = amount(invoice.totalAmount);
      const tax = amount(invoice.taxAmount);
      return {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status,
        currency: invoice.currency,
        // Numbers, never serialized Decimal strings (spec B2.2).
        totalAmount: total,
        amountPaid: amount(invoice.amountPaid),
        taxAmount: tax,
        netAmount: round2(total - tax),
        approvedAt: invoice.approvedAt,
        sentAt: invoice.sentAt,
        paidAt: invoice.paidAt,
      };
    });
  }

  downloadInvoicePdf(token: string, invoiceId: string) {
    return this.contextFromToken(token).then((ctx) => this.downloadInvoicePdfFor(ctx, invoiceId));
  }

  /**
   * Streams the PDF attached to one of the customer's own statements. Every
   * miss - unknown id, another customer's invoice, billing disabled, no file -
   * answers the same 404 so the portal cannot probe the tenant's invoices.
   */
  async downloadInvoicePdfFor(ctx: PortalContext, invoiceId: string) {
    const enabled = await this.modulesCache.getEnabledKeys(ctx.tenantId);
    if (!enabled.has(MODULE_KEYS.BILLING)) throw new NotFoundException('Invoice not found');
    const invoice = await this.prisma.customerInvoice.findFirst({
      where: {
        id: invoiceId,
        tenantId: ctx.tenantId,
        customerId: ctx.customerId,
        status: { in: PORTAL_VISIBLE_INVOICE_STATUSES },
      },
      select: { id: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    const document = await this.prisma.document.findFirst({
      where: {
        tenantId: ctx.tenantId,
        entityType: 'customer-invoice',
        entityId: invoice.id,
        mimeType: 'application/pdf',
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!document) throw new NotFoundException('Invoice not found');
    return this.documents.download(ctx.tenantId, document.id);
  }

  listShipmentDocuments(token: string, shipmentId: string) {
    return this.contextFromToken(token).then((ctx) =>
      this.listShipmentDocumentsFor(ctx, shipmentId),
    );
  }

  async listShipmentDocumentsFor(ctx: PortalContext, shipmentId: string) {
    await this.customerShipment(ctx.tenantId, ctx.customerId, shipmentId);
    const docs = await this.documents.listForEntity(ctx.tenantId, 'proof-of-delivery', shipmentId);
    return docs.map(({ id, fileName, mimeType, createdAt }) => ({
      id,
      fileName,
      mimeType,
      createdAt,
    }));
  }

  downloadShipmentDocument(token: string, documentId: string) {
    return this.contextFromToken(token).then((ctx) =>
      this.downloadShipmentDocumentFor(ctx, documentId),
    );
  }

  async downloadShipmentDocumentFor(ctx: PortalContext, documentId: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, tenantId: ctx.tenantId, entityType: 'proof-of-delivery' },
    });
    if (!doc) throw new NotFoundException('Document not found');
    const shipment = await this.prisma.shipment.findFirst({
      where: { id: doc.entityId, tenantId: ctx.tenantId },
      select: { transportOrder: { select: { customerId: true } } },
    });
    if (!shipment || shipment.transportOrder.customerId !== ctx.customerId) {
      // Same wording as an unknown document: a customer must not learn that a
      // document of another customer exists.
      throw new NotFoundException('Document not found');
    }
    return this.documents.download(ctx.tenantId, documentId);
  }

  listTemplates(token: string) {
    return this.contextFromToken(token).then((ctx) => this.listTemplatesFor(ctx));
  }

  async listTemplatesFor(ctx: PortalContext) {
    const templates = await this.prisma.orderTemplate.findMany({
      where: { tenantId: ctx.tenantId, customerId: ctx.customerId },
      orderBy: { createdAt: 'desc' },
    });
    const codes = await this.locationCodes(
      ctx.tenantId,
      templates.flatMap((t) => [t.originLocationId, t.destinationLocationId]),
    );
    return templates.map((t) => projectTemplate(t, codes));
  }

  /** Maps location PKs to their opaque codes, scoped to the tenant (rule 1). */
  private async locationCodes(
    tenantId: string,
    ids: Array<string | null>,
  ): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((id): id is string => !!id))];
    if (wanted.length === 0) return new Map();
    const locations = await this.prisma.location.findMany({
      where: { tenantId, id: { in: wanted } },
      select: { id: true, code: true },
    });
    return new Map(locations.map((l) => [l.id, l.code]));
  }

  createTemplate(token: string, dto: CreateOrderTemplateInput) {
    return this.contextFromToken(token).then((ctx) => this.createTemplateFor(ctx, dto));
  }

  /** `originLocationId`/`destinationLocationId` in the payload are location **codes**. */
  async createTemplateFor(ctx: PortalContext, dto: CreateOrderTemplateInput) {
    // Resolve opaque codes → PKs before ownership check and persistence.
    const originId = dto.originLocationId
      ? await this.resolveLocationCode(ctx.tenantId, dto.originLocationId)
      : undefined;
    const destinationId = dto.destinationLocationId
      ? await this.resolveLocationCode(ctx.tenantId, dto.destinationLocationId)
      : undefined;
    await Promise.all([
      originId ? this.ownership.assertOwned('location', originId, ctx.tenantId) : Promise.resolve(),
      destinationId
        ? this.ownership.assertOwned('location', destinationId, ctx.tenantId)
        : Promise.resolve(),
    ]);
    const template = await this.prisma.orderTemplate.create({
      data: {
        tenantId: ctx.tenantId,
        customerId: ctx.customerId,
        name: dto.name,
        originLocationId: originId,
        destinationLocationId: destinationId,
        mode: dto.mode,
        totalWeightKg: dto.totalWeightKg,
        totalVolumeM3: dto.totalVolumeM3,
        palletCount: dto.palletCount,
        notes: dto.notes,
      },
    });
    await this.audit.log({
      tenantId: ctx.tenantId,
      action: AuditAction.CREATE,
      entityType: 'order-template',
      entityId: template.id,
      after: { name: template.name, customerId: ctx.customerId, ...this.actorTrace(ctx) },
    });
    // The codes are the ones just validated — no need to read them back.
    const codes = new Map<string, string>();
    if (originId && dto.originLocationId) codes.set(originId, dto.originLocationId);
    if (destinationId && dto.destinationLocationId) {
      codes.set(destinationId, dto.destinationLocationId);
    }
    return projectTemplate(template, codes);
  }

  deleteTemplate(token: string, id: string) {
    return this.contextFromToken(token).then((ctx) => this.deleteTemplateFor(ctx, id));
  }

  async deleteTemplateFor(ctx: PortalContext, id: string) {
    const template = await this.prisma.orderTemplate.findFirst({
      where: { id, tenantId: ctx.tenantId, customerId: ctx.customerId },
    });
    if (!template) throw new NotFoundException('Template not found');
    const { count } = await this.prisma.orderTemplate.deleteMany({
      where: { id, tenantId: ctx.tenantId, customerId: ctx.customerId },
    });
    if (count === 0) throw new NotFoundException('Template not found');
    await this.audit.log({
      tenantId: ctx.tenantId,
      action: AuditAction.DELETE,
      entityType: 'order-template',
      entityId: id,
      before: { name: template.name },
      ...(ctx.actor ? { after: this.actorTrace(ctx) } : {}),
    });
    return { deleted: true };
  }

  /**
   * Resolves a shipment the customer is allowed to see (it must belong to one of
   * their transport orders). Same ownership logic as change-request/documents.
   */
  async customerShipment(tenantId: string, customerId: string, shipmentId: string) {
    const shipment = await this.prisma.shipment.findFirst({
      where: { id: shipmentId, tenantId },
      select: { id: true, transportOrder: { select: { customerId: true } } },
    });
    if (!shipment || shipment.transportOrder.customerId !== customerId) {
      throw new NotFoundException('Shipment not found');
    }
    return shipment;
  }

  /** Public: the comment thread for a shipment, projected per rule 10. */
  listShipmentComments(token: string, shipmentId: string): Promise<ShipmentCommentView[]> {
    return this.contextFromToken(token).then((ctx) =>
      this.listShipmentCommentsFor(ctx, shipmentId),
    );
  }

  async listShipmentCommentsFor(
    ctx: PortalContext,
    shipmentId: string,
  ): Promise<ShipmentCommentView[]> {
    await this.customerShipment(ctx.tenantId, ctx.customerId, shipmentId);
    const comments = await this.prisma.shipmentComment.findMany({
      where: { tenantId: ctx.tenantId, shipmentId },
      orderBy: { createdAt: 'asc' },
    });
    return comments.map(projectShipmentComment);
  }

  /** Public: the customer posts a comment on one of their shipments. */
  createShipmentComment(
    token: string,
    shipmentId: string,
    body: string,
  ): Promise<ShipmentCommentView> {
    return this.contextFromToken(token).then((ctx) =>
      this.createShipmentCommentFor(ctx, shipmentId, body),
    );
  }

  async createShipmentCommentFor(
    ctx: PortalContext,
    shipmentId: string,
    body: string,
  ): Promise<ShipmentCommentView> {
    await this.customerShipment(ctx.tenantId, ctx.customerId, shipmentId);
    const comment = await this.prisma.shipmentComment.create({
      data: {
        tenantId: ctx.tenantId,
        shipmentId,
        authorType: 'CUSTOMER',
        // A named account signs with its own id and "Person · Company"; a shared
        // capability link can only sign for the company itself.
        authorId: ctx.actor?.portalUserId ?? ctx.customerId,
        authorName: ctx.actor ? `${ctx.actor.displayName} · ${ctx.customerName}` : ctx.customerName,
        body,
      },
    });
    await this.audit.log({
      tenantId: ctx.tenantId,
      action: AuditAction.CREATE,
      entityType: 'shipment-comment',
      entityId: comment.id,
      after: {
        shipmentId,
        authorType: 'CUSTOMER',
        customer: ctx.customerName,
        ...this.actorTrace(ctx),
      },
    });
    return projectShipmentComment(comment);
  }

  async getBranding(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    const branding = ((tenant.settings as Record<string, unknown> | null)?.branding ??
      {}) as Record<string, unknown>;
    return {
      logoUrl: typeof branding.logoUrl === 'string' ? branding.logoUrl : '',
      accentColor: typeof branding.accentColor === 'string' ? branding.accentColor : undefined,
    };
  }

  async uploadLogo(
    tenantId: string,
    userId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string },
  ) {
    const b = file.buffer;
    const mimeType =
      b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ? 'image/png'
        : b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255
          ? 'image/jpeg'
          : b.length >= 12 &&
              b.toString('ascii', 0, 4) === 'RIFF' &&
              b.toString('ascii', 8, 12) === 'WEBP'
            ? 'image/webp'
            : null;
    if (!mimeType || b.length > 2 * 1024 * 1024)
      throw new BadRequestException('Logo : PNG, JPEG ou WebP uniquement, 2 Mo maximum.');
    const token = randomBytes(24).toString('base64url');
    const doc = await this.documents.upload(tenantId, {
      entityType: 'portal-logo',
      entityId: token,
      fileName: file.originalname,
      mimeType,
      body: b,
      uploadedById: userId,
    });
    try {
      return await this.setBranding(
        tenantId,
        { logoUrl: `/api/v1/public/portal/branding/logo/${token}` },
        userId,
      );
    } catch (error) {
      await this.documents.remove(tenantId, doc.id).catch(() => {});
      throw error;
    }
  }

  async getLogo(token: string) {
    if (!/^[A-Za-z0-9_-]{32}$/.test(token)) throw new NotFoundException('Logo introuvable');
    const doc = await this.prisma.document.findFirst({
      where: { entityType: 'portal-logo', entityId: token },
      select: { id: true, tenantId: true, mimeType: true },
    });
    if (!doc || !['image/png', 'image/jpeg', 'image/webp'].includes(doc.mimeType))
      throw new NotFoundException('Logo introuvable');
    if (!(await this.modulesCache.getEnabledKeys(doc.tenantId)).has(MODULE_KEYS.CUSTOMER_PORTAL))
      throw new NotFoundException('Logo introuvable');
    const branding = await this.getBranding(doc.tenantId);
    if (branding.logoUrl !== `/api/v1/public/portal/branding/logo/${token}`)
      throw new NotFoundException('Logo remplacé');
    return this.documents.download(doc.tenantId, doc.id);
  }

  async setBranding(
    tenantId: string,
    dto: { logoUrl?: string; accentColor?: string },
    userId?: string,
  ) {
    if (
      dto.logoUrl &&
      !/^https?:\/\//i.test(dto.logoUrl) &&
      !/^\/api\/v1\/public\/portal\/branding\/logo\/[A-Za-z0-9_-]{32}$/.test(dto.logoUrl)
    )
      throw new BadRequestException('Utilisez une URL HTTP(S) ou importez un logo.');
    if (dto.accentColor) {
      if (!/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(dto.accentColor)) {
        throw new BadRequestException('accentColor must be a valid hex color (e.g. #RRGGBB)');
      }
    }
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    const currentSettings = (tenant.settings as Record<string, unknown>) ?? {};
    const currentBranding = (currentSettings.branding as Record<string, unknown>) ?? {};
    const newBranding = {
      ...currentBranding,
      ...(dto.logoUrl !== undefined ? { logoUrl: dto.logoUrl } : {}),
      ...(dto.accentColor !== undefined ? { accentColor: dto.accentColor } : {}),
    };
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { settings: { ...currentSettings, branding: newBranding } },
    });
    await this.audit.log({
      tenantId,
      action: AuditAction.UPDATE,
      entityType: 'tenant-branding',
      userId,
      entityId: tenantId,
      before: currentBranding,
      after: newBranding,
    });
    return newBranding;
  }
}
