import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditAction, MODULE_KEYS } from '@pulsar/shared';
import { randomBytes } from 'node:crypto';
import { OwnershipService } from '../../prisma/ownership.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SequencesService } from '../../prisma/sequences.service';
import { TenantModulesCacheService } from '../../prisma/tenant-modules-cache.service';
import { AuditLogsService } from '../../core/audit-logs/audit-logs.service';

export interface PortalOrderInput {
  originLocationId: string;
  destinationLocationId: string;
  customerReference?: string;
  requestedPickupDate?: string;
  requestedDeliveryDate?: string;
  totalWeightKg?: number;
  palletCount?: number;
  notes?: string;
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
  ) {}

  /** Resolves + gates a portal token (module must be enabled for the tenant). */
  private async customerByToken(token: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { portalToken: token },
      include: { tenant: { select: { name: true } } },
    });
    if (!customer) throw new NotFoundException('Unknown portal link');
    const enabled = await this.modulesCache.getEnabledKeys(customer.tenantId);
    if (!enabled.has(MODULE_KEYS.CUSTOMER_PORTAL)) {
      throw new ForbiddenException('The customer portal is not enabled for this shipper');
    }
    return customer;
  }

  /**
   * Portal v2: the customer submits a transport request, landing as a DRAFT
   * order for the shipper's customer service to confirm (or cancel).
   */
  async createOrder(token: string, input: PortalOrderInput) {
    const customer = await this.customerByToken(token);
    await Promise.all([
      this.ownership.assertOwned('location', input.originLocationId, customer.tenantId),
      this.ownership.assertOwned('location', input.destinationLocationId, customer.tenantId),
    ]);

    const order = await this.prisma.transportOrder.create({
      data: {
        tenantId: customer.tenantId,
        orderNumber: await this.sequences.nextNumber(customer.tenantId, 'transport-order'),
        customerId: customer.id,
        customerReference: input.customerReference,
        originLocationId: input.originLocationId,
        destinationLocationId: input.destinationLocationId,
        requestedPickupDate: input.requestedPickupDate
          ? new Date(input.requestedPickupDate)
          : undefined,
        requestedDeliveryDate: input.requestedDeliveryDate
          ? new Date(input.requestedDeliveryDate)
          : undefined,
        totalWeightKg: input.totalWeightKg,
        palletCount: input.palletCount,
        notes: input.notes,
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
        orderNumber: true,
        customerReference: true,
        status: true,
        requestedPickupDate: true,
        requestedDeliveryDate: true,
        createdAt: true,
        originLocation: { select: { city: true, state: true } },
        destinationLocation: { select: { city: true, state: true } },
        shipments: {
          select: {
            shipmentNumber: true,
            status: true,
            actualDeliveryAt: true,
            trackingToken: true,
          },
        },
      },
    });

    // Locations are exposed minimally (id/name/city) so the customer can place
    // requests — the only internal references a portal needs.
    const locations = await this.prisma.location.findMany({
      where: { tenantId: customer.tenantId, isActive: true },
      orderBy: { name: 'asc' },
      take: 100,
      select: { id: true, name: true, city: true },
    });

    const webUrl = this.config.get('WEB_URL', 'http://localhost:5173');
    return {
      shipper: customer.tenant.name,
      customer: customer.name,
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
}
