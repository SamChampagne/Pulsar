import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PortalAuthUser } from '@pulsar/shared';
import { AuditAction, CustomerInvoiceStatus, DOMAIN_EVENT_TYPES, MODULE_KEYS, TransportMode } from '@pulsar/shared';
import { randomBytes } from 'node:crypto';
import { OwnershipService } from '../../prisma/ownership.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SequencesService } from '../../prisma/sequences.service';
import { TenantModulesCacheService } from '../../prisma/tenant-modules-cache.service';
import { AuditLogsService } from '../../core/audit-logs/audit-logs.service';
import { DocumentsService } from '../../core/documents/documents.service';
import { DomainEventsService } from '../../core/operating/domain-events.service';
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

export interface PortalChangeRequestInput {
  orderId?: string;
  shipmentId?: string;
  kind: string;
  note: string;
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
    private readonly domainEvents: DomainEventsService,
  ) {}

  /** Resolves + gates a portal token (module must be enabled for the tenant). */
  private async customerByToken(token: string): Promise<PortalContext> {
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
    return this.customerByToken(token).then((ctx) => this.createOrderFor(ctx, input));
  }

  async createOrderFor(ctx: PortalContext, input: PortalOrderInput) {
    // Resolve opaque location codes (from the public payload) to internal PKs before merging.
    const resolvedOriginId = input.originLocationId
      ? await this.resolveLocationCode(ctx.tenantId, input.originLocationId)
      : undefined;
    const resolvedDestinationId = input.destinationLocationId
      ? await this.resolveLocationCode(ctx.tenantId, input.destinationLocationId)
      : undefined;

    let mergedInput = { ...input, originLocationId: resolvedOriginId, destinationLocationId: resolvedDestinationId };
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
      throw new BadRequestException('origin/destination requis (fournir directement ou via un template)');
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
    return this.customerByToken(token).then((ctx) => this.getPortalViewFor(ctx));
  }

  async getPortalViewFor(ctx: PortalContext) {
    const orders = await this.prisma.transportOrder.findMany({
      where: { tenantId: ctx.tenantId, customerId: ctx.customerId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        orderNumber: true,
        customerReference: true,
        status: true,
        requestedPickupEarly: true,
        requestedPickupLate: true,
        requestedDeliveryEarly: true,
        requestedDeliveryLate: true,
        createdAt: true,
        originLocation: { select: { city: true, state: true } },
        destinationLocation: { select: { city: true, state: true } },
        shipments: {
          select: {
            id: true,
            shipmentNumber: true,
            status: true,
            actualDeliveryAt: true,
            trackingToken: true,
          },
        },
      },
    });

    // Locations are exposed minimally (code/name/city) — opaque code instead of PK (rule 10).
    const locations = await this.prisma.location.findMany({
      where: { tenantId: ctx.tenantId, isActive: true },
      orderBy: { name: 'asc' },
      take: 100,
      select: { code: true, name: true, city: true },
    });

    const branding = ((ctx.settings as Record<string, unknown>)?.branding as Record<string, unknown>) ?? {};
    const webUrl = this.config.get('WEB_URL', 'http://localhost:5173');
    return {
      shipper: ctx.tenantName,
      customer: ctx.customerName,
      branding,
      locations,
      orders: orders.map((order) => ({
        ...order,
        shipments: order.shipments.map(({ trackingToken, ...shipment }) => ({
          ...shipment,
          trackingUrl: trackingToken ? `${webUrl}/track/${trackingToken}` : null,
        })),
      })),
    };
  }

  listInvoices(token: string) {
    return this.customerByToken(token).then((ctx) => this.listInvoicesFor(ctx));
  }

  async listInvoicesFor(ctx: PortalContext) {
    const enabled = await this.modulesCache.getEnabledKeys(ctx.tenantId);
    if (!enabled.has(MODULE_KEYS.BILLING)) return [];
    const invoices = await this.prisma.customerInvoice.findMany({
      where: {
        tenantId: ctx.tenantId,
        customerId: ctx.customerId,
        status: { in: [CustomerInvoiceStatus.APPROVED, CustomerInvoiceStatus.SENT, CustomerInvoiceStatus.PAID] },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return invoices.map(({ invoiceNumber, status, currency, totalAmount, sentAt, paidAt }) => ({
      invoiceNumber,
      status,
      currency,
      totalAmount,
      sentAt,
      paidAt,
    }));
  }

  listShipmentDocuments(token: string, shipmentId: string) {
    return this.customerByToken(token).then((ctx) => this.listShipmentDocumentsFor(ctx, shipmentId));
  }

  async listShipmentDocumentsFor(ctx: PortalContext, shipmentId: string) {
    await this.customerShipment(ctx.tenantId, ctx.customerId, shipmentId);
    const docs = await this.documents.listForEntity(ctx.tenantId, 'proof-of-delivery', shipmentId);
    return docs.map(({ id, fileName, mimeType, createdAt }) => ({ id, fileName, mimeType, createdAt }));
  }

  downloadShipmentDocument(token: string, documentId: string) {
    return this.customerByToken(token).then((ctx) =>
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
    return this.customerByToken(token).then((ctx) => this.listTemplatesFor(ctx));
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
    return this.customerByToken(token).then((ctx) => this.createTemplateFor(ctx, dto));
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
    return this.customerByToken(token).then((ctx) => this.deleteTemplateFor(ctx, id));
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

  createChangeRequest(token: string, dto: PortalChangeRequestInput) {
    return this.customerByToken(token).then((ctx) => this.createChangeRequestFor(ctx, dto));
  }

  async createChangeRequestFor(ctx: PortalContext, dto: PortalChangeRequestInput) {
    let subject: { type: string; id: string };
    let orderNumber: string | undefined;

    if (dto.orderId) {
      const order = await this.prisma.transportOrder.findFirst({
        where: { id: dto.orderId, tenantId: ctx.tenantId, customerId: ctx.customerId },
        select: { id: true, orderNumber: true },
      });
      if (!order) throw new NotFoundException('Order not found');
      subject = { type: 'transport-order', id: order.id };
      orderNumber = order.orderNumber;
    } else if (dto.shipmentId) {
      const shipment = await this.customerShipment(ctx.tenantId, ctx.customerId, dto.shipmentId);
      subject = { type: 'shipment', id: shipment.id };
    } else {
      throw new BadRequestException('orderId or shipmentId is required');
    }

    const bucket = new Date().toISOString().slice(0, 16);
    void this.domainEvents
      .emit(ctx.tenantId, DOMAIN_EVENT_TYPES.PORTAL_CHANGE_REQUEST, subject, {
        subject,
        kind: dto.kind,
        note: dto.note,
        bucket,
        customerName: ctx.customerName,
        ...(orderNumber ? { orderNumber } : {}),
        ...this.actorTrace(ctx),
      })
      .catch(() => { /* best-effort */ });

    void this.audit.log({
      tenantId: ctx.tenantId,
      action: AuditAction.CREATE,
      entityType: 'change-request',
      entityId: dto.shipmentId ?? dto.orderId ?? '',
      after: { kind: dto.kind, note: dto.note, customer: ctx.customerName, ...this.actorTrace(ctx) },
    }).catch(() => { /* best-effort */ });

    return { ok: true };
  }

  /**
   * Resolves a shipment the customer is allowed to see (it must belong to one of
   * their transport orders). Same ownership logic as change-request/documents.
   */
  private async customerShipment(tenantId: string, customerId: string, shipmentId: string) {
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
    return this.customerByToken(token).then((ctx) => this.listShipmentCommentsFor(ctx, shipmentId));
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
    return this.customerByToken(token).then((ctx) =>
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

  async setBranding(tenantId: string, dto: { logoUrl?: string; accentColor?: string }) {
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
      entityId: tenantId,
      before: currentBranding,
      after: newBranding,
    });
    return newBranding;
  }
}
