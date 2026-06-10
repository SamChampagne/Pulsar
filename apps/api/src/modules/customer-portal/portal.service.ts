import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MODULE_KEYS } from '@pulsar/shared';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantModulesCacheService } from '../../prisma/tenant-modules-cache.service';

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
    private readonly config: ConfigService,
  ) {}

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
    const customer = await this.prisma.customer.findUnique({
      where: { portalToken: token },
      include: { tenant: { select: { name: true } } },
    });
    if (!customer) throw new NotFoundException('Unknown portal link');

    const enabled = await this.modulesCache.getEnabledKeys(customer.tenantId);
    if (!enabled.has(MODULE_KEYS.CUSTOMER_PORTAL)) {
      throw new ForbiddenException('The customer portal is not enabled for this shipper');
    }

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

    const webUrl = this.config.get('WEB_URL', 'http://localhost:5173');
    return {
      shipper: customer.tenant.name,
      customer: customer.name,
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
