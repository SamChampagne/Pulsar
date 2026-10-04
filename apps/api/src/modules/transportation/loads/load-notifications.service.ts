import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DOMAIN_EVENT_TYPES } from '@pulsar/shared';
import { MailService } from '../../../core/email/mail.service';
import { DomainEventsService } from '../../../core/operating/domain-events.service';
import { PrismaService } from '../../../prisma/prisma.service';

/** Minimal load shape needed for outbound notifications. */
interface LoadRef {
  id: string;
  loadNumber: string;
  carrierId?: string | null;
  hasReturnedPackages?: boolean;
}

/**
 * Side-effect notifications that happen after a load lifecycle transition.
 * All methods are best-effort: callers `await` them but their individual
 * operations are fire-and-forget in nature (webhooks / domain events / email).
 * None of these methods modify load or shipment state — they are pure
 * outbound signals.
 */
@Injectable()
export class LoadNotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly domainEvents: DomainEventsService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  /** Called after a load transitions to DISPATCHED. */
  async onDispatched(tenantId: string, load: LoadRef): Promise<void> {
    // Rule 55: the domain event is the single feed — DomainEventsService bridges
    // it to the webhook outbox (no direct webhooks.emit, which would duplicate
    // every delivery).
    // Best-effort domain event (rule 27).
    await this.domainEvents.emit(
      tenantId,
      DOMAIN_EVENT_TYPES.LOAD_DISPATCHED,
      { type: 'load', id: load.id },
      { loadId: load.id, loadNumber: load.loadNumber, carrierId: load.carrierId ?? null },
    );
  }

  /** Called after a load transitions to COMPLETED. */
  async onCompleted(tenantId: string, load: LoadRef): Promise<void> {
    // Rule 55: bridged to the webhook outbox by DomainEventsService.
    // Best-effort domain event (rule 27).
    await this.domainEvents.emit(
      tenantId,
      load.hasReturnedPackages
        ? DOMAIN_EVENT_TYPES.LOAD_CLOSED_WITH_RETURNS
        : DOMAIN_EVENT_TYPES.LOAD_COMPLETED,
      { type: 'load', id: load.id },
      { loadId: load.id, loadNumber: load.loadNumber, carrierId: load.carrierId ?? null },
    );
    await this.notifyCustomersDelivered(tenantId, load.id);
  }

  /**
   * Emails each order's customer contact that their shipment was delivered
   * (best-effort — a failed send does not bubble up).
   */
  private async notifyCustomersDelivered(tenantId: string, loadId: string): Promise<void> {
    const shipments = await this.prisma.shipment.findMany({
      where: {
        tenantId,
        loadId,
        status: { in: ['DELIVERED', 'CLOSED'] },
        deliveryPackages: { none: { tenantId, status: 'RETURNED' } },
      },
      select: {
        shipmentNumber: true,
        trackingToken: true,
        actualDeliveryAt: true,
        transportOrder: {
          select: {
            orderNumber: true,
            customerReference: true,
            customer: { select: { email: true, name: true } },
          },
        },
      },
    });
    const webUrl = this.config.get('WEB_URL', 'http://localhost:5173');
    for (const shipment of shipments) {
      const to = shipment.transportOrder.customer.email;
      if (!to) continue;
      const trackLine = shipment.trackingToken
        ? `<p><a href="${webUrl}/track/${shipment.trackingToken}">Track this shipment</a></p>`
        : '';
      // Route through the durable outbox — recorded in the tenant's email history.
      await this.mail.queue(tenantId, {
        toAddresses: [to],
        subject: `Delivered — ${shipment.shipmentNumber} (order ${shipment.transportOrder.orderNumber})`,
        html: [
          `<p>Your shipment <strong>${shipment.shipmentNumber}</strong>`,
          shipment.transportOrder.customerReference
            ? ` (ref ${shipment.transportOrder.customerReference})`
            : '',
          ` was delivered on ${shipment.actualDeliveryAt?.toUTCString() ?? 'today'}.</p>`,
          trackLine,
        ].join(''),
        text: `Your shipment ${shipment.shipmentNumber} was delivered.`,
        relatedType: 'load',
        relatedId: loadId,
      });
    }
  }
}
