import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
 * Customer Portal v1: capability-link visibility for the shipper's customers.
 * One revocable token per customer opens a read-only page listing their orders,
 * shipment statuses and public tracking links. Same security model as
 * tender/tracking/driver links (see docs/collaboration.md).
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
  private async customerByToken(token: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { portalToken: token },
      include: { tenant: { select: { name: true, settings: true } } },
    });
    if (!customer) throw new NotFoundException('Unknown portal link');
    const enabled = await this.modulesCache.getEnabledKeys(customer.tenantId);
    if (!enabled.has(MODULE_KEYS.CUSTOMER_PORTAL)) {
      throw new ForbiddenException('The customer portal is not enabled for this shipper');
    }
    return customer;
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
  async createOrder(token: string, input: PortalOrderInput) {
    const customer = await this.customerByToken(token);

    // Resolve opaque location codes (from the public payload) to internal PKs before merging.
    const resolvedOriginId = input.originLocationId
      ? await this.resolveLocationCode(customer.tenantId, input.originLocationId)
      : undefined;
    const resolvedDestinationId = input.destinationLocationId
      ? await this.resolveLocationCode(customer.tenantId, input.destinationLocationId)
      : undefined;

    let mergedInput = { ...input, originLocationId: resolvedOriginId, destinationLocationId: resolvedDestinationId };
    if (input.templateId) {
      const tpl = await this.prisma.orderTemplate.findFirst({
        where: { id: input.templateId, tenantId: customer.tenantId, customerId: customer.id },
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
      this.ownership.assertOwned('location', mergedInput.originLocationId, customer.tenantId),
      this.ownership.assertOwned('location', mergedInput.destinationLocationId, customer.tenantId),
    ]);

    const pickupEarly = toDate(mergedInput.requestedPickupEarly);
    const pickupLate = toDate(mergedInput.requestedPickupLate);
    const deliveryEarly = toDate(mergedInput.requestedDeliveryEarly);
    const deliveryLate = toDate(mergedInput.requestedDeliveryLate);
    assertWindowCoherence({ pickupEarly, pickupLate, deliveryEarly, deliveryLate });

    const order = await this.prisma.transportOrder.create({
      data: {
        tenantId: customer.tenantId,
        orderNumber: await this.sequences.nextNumber(customer.tenantId, 'transport-order'),
        customerId: customer.id,
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
      },
    });
    await this.audit.log({
      tenantId: customer.tenantId,
      action: AuditAction.CREATE,
      entityType: 'transport-order',
      entityId: order.id,
      after: { orderNumber: order.orderNumber, source: 'customer-portal', customerId: customer.id },
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
  async getPortalView(token: string) {
    const customer = await this.customerByToken(token);

    const orders = await this.prisma.transportOrder.findMany({
      where: { tenantId: customer.tenantId, customerId: customer.id },
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
      where: { tenantId: customer.tenantId, isActive: true },
      orderBy: { name: 'asc' },
      take: 100,
      select: { code: true, name: true, city: true },
    });

    const branding = ((customer.tenant.settings as Record<string, unknown>)?.branding as Record<string, unknown>) ?? {};
    const webUrl = this.config.get('WEB_URL', 'http://localhost:5173');
    return {
      shipper: customer.tenant.name,
      customer: customer.name,
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

  async listInvoices(token: string) {
    const customer = await this.customerByToken(token);
    const enabled = await this.modulesCache.getEnabledKeys(customer.tenantId);
    if (!enabled.has(MODULE_KEYS.BILLING)) return [];
    const invoices = await this.prisma.customerInvoice.findMany({
      where: {
        tenantId: customer.tenantId,
        customerId: customer.id,
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

  async listShipmentDocuments(token: string, shipmentId: string) {
    const customer = await this.customerByToken(token);
    const shipment = await this.prisma.shipment.findFirst({
      where: { id: shipmentId, tenantId: customer.tenantId },
      select: { id: true, transportOrder: { select: { customerId: true } } },
    });
    if (!shipment || shipment.transportOrder.customerId !== customer.id) {
      throw new NotFoundException('Shipment not found');
    }
    const docs = await this.documents.listForEntity(customer.tenantId, 'proof-of-delivery', shipmentId);
    return docs.map(({ id, fileName, mimeType, createdAt }) => ({ id, fileName, mimeType, createdAt }));
  }

  async downloadShipmentDocument(token: string, documentId: string) {
    const customer = await this.customerByToken(token);
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, tenantId: customer.tenantId, entityType: 'proof-of-delivery' },
    });
    if (!doc) throw new NotFoundException('Document not found');
    const shipment = await this.prisma.shipment.findFirst({
      where: { id: doc.entityId, tenantId: customer.tenantId },
      select: { transportOrder: { select: { customerId: true } } },
    });
    if (!shipment || shipment.transportOrder.customerId !== customer.id) {
      throw new NotFoundException('Document not found');
    }
    return this.documents.download(customer.tenantId, documentId);
  }

  async listTemplates(token: string) {
    const customer = await this.customerByToken(token);
    const templates = await this.prisma.orderTemplate.findMany({
      where: { tenantId: customer.tenantId, customerId: customer.id },
      orderBy: { createdAt: 'desc' },
    });
    return templates.map((t) => ({
      id: t.id,
      name: t.name,
      originLocationId: t.originLocationId,
      destinationLocationId: t.destinationLocationId,
      mode: t.mode,
      totalWeightKg: t.totalWeightKg,
      totalVolumeM3: t.totalVolumeM3,
      palletCount: t.palletCount,
      notes: t.notes,
      createdAt: t.createdAt,
    }));
  }

  async createTemplate(token: string, dto: CreateOrderTemplateInput) {
    const customer = await this.customerByToken(token);
    // Resolve opaque codes → PKs before ownership check and persistence.
    const originId = dto.originLocationId
      ? await this.resolveLocationCode(customer.tenantId, dto.originLocationId)
      : undefined;
    const destinationId = dto.destinationLocationId
      ? await this.resolveLocationCode(customer.tenantId, dto.destinationLocationId)
      : undefined;
    await Promise.all([
      originId
        ? this.ownership.assertOwned('location', originId, customer.tenantId)
        : Promise.resolve(),
      destinationId
        ? this.ownership.assertOwned('location', destinationId, customer.tenantId)
        : Promise.resolve(),
    ]);
    const template = await this.prisma.orderTemplate.create({
      data: {
        tenantId: customer.tenantId,
        customerId: customer.id,
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
      tenantId: customer.tenantId,
      action: AuditAction.CREATE,
      entityType: 'order-template',
      entityId: template.id,
      after: { name: template.name, customerId: customer.id },
    });
    const { id, name, originLocationId, destinationLocationId, mode, totalWeightKg, totalVolumeM3, palletCount, notes, createdAt } = template;
    return { id, name, originLocationId, destinationLocationId, mode, totalWeightKg, totalVolumeM3, palletCount, notes, createdAt };
  }

  async deleteTemplate(token: string, id: string) {
    const customer = await this.customerByToken(token);
    const template = await this.prisma.orderTemplate.findFirst({
      where: { id, tenantId: customer.tenantId, customerId: customer.id },
    });
    if (!template) throw new NotFoundException('Template not found');
    const { count } = await this.prisma.orderTemplate.deleteMany({
      where: { id, tenantId: customer.tenantId, customerId: customer.id },
    });
    if (count === 0) throw new NotFoundException('Template not found');
    await this.audit.log({
      tenantId: customer.tenantId,
      action: AuditAction.DELETE,
      entityType: 'order-template',
      entityId: id,
      before: { name: template.name },
    });
    return { deleted: true };
  }

  async createChangeRequest(token: string, dto: PortalChangeRequestInput) {
    const customer = await this.customerByToken(token);
    let subject: { type: string; id: string };
    let orderNumber: string | undefined;

    if (dto.orderId) {
      const order = await this.prisma.transportOrder.findFirst({
        where: { id: dto.orderId, tenantId: customer.tenantId, customerId: customer.id },
        select: { id: true, orderNumber: true },
      });
      if (!order) throw new NotFoundException('Order not found');
      subject = { type: 'transport-order', id: order.id };
      orderNumber = order.orderNumber;
    } else if (dto.shipmentId) {
      const shipment = await this.prisma.shipment.findFirst({
        where: { id: dto.shipmentId, tenantId: customer.tenantId },
        select: { id: true, transportOrder: { select: { customerId: true } } },
      });
      if (!shipment || shipment.transportOrder.customerId !== customer.id) {
        throw new NotFoundException('Shipment not found');
      }
      subject = { type: 'shipment', id: shipment.id };
    } else {
      throw new BadRequestException('orderId or shipmentId is required');
    }

    const bucket = new Date().toISOString().slice(0, 16);
    void this.domainEvents
      .emit(customer.tenantId, DOMAIN_EVENT_TYPES.PORTAL_CHANGE_REQUEST, subject, {
        subject,
        kind: dto.kind,
        note: dto.note,
        bucket,
        customerName: customer.name,
        ...(orderNumber ? { orderNumber } : {}),
      })
      .catch(() => { /* best-effort */ });

    void this.audit.log({
      tenantId: customer.tenantId,
      action: AuditAction.CREATE,
      entityType: 'change-request',
      entityId: dto.shipmentId ?? dto.orderId ?? '',
      after: { kind: dto.kind, note: dto.note, customer: customer.name },
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
  async listShipmentComments(token: string, shipmentId: string): Promise<ShipmentCommentView[]> {
    const customer = await this.customerByToken(token);
    await this.customerShipment(customer.tenantId, customer.id, shipmentId);
    const comments = await this.prisma.shipmentComment.findMany({
      where: { tenantId: customer.tenantId, shipmentId },
      orderBy: { createdAt: 'asc' },
    });
    return comments.map(projectShipmentComment);
  }

  /** Public: the customer posts a comment on one of their shipments. */
  async createShipmentComment(token: string, shipmentId: string, body: string): Promise<ShipmentCommentView> {
    const customer = await this.customerByToken(token);
    await this.customerShipment(customer.tenantId, customer.id, shipmentId);
    const comment = await this.prisma.shipmentComment.create({
      data: {
        tenantId: customer.tenantId,
        shipmentId,
        authorType: 'CUSTOMER',
        authorId: customer.id,
        authorName: customer.name,
        body,
      },
    });
    await this.audit.log({
      tenantId: customer.tenantId,
      action: AuditAction.CREATE,
      entityType: 'shipment-comment',
      entityId: comment.id,
      after: { shipmentId, authorType: 'CUSTOMER', customer: customer.name },
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
