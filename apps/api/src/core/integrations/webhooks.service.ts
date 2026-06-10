import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@pulsar/database';
import { createHmac } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';

interface WebhookConfig {
  url?: string;
  secret?: string;
  /** Event allowlist, e.g. ["load.dispatched", "tender.accepted"]. Empty/absent = all. */
  events?: string[];
}

const MAX_ATTEMPTS = 5;
const BACKOFF_MINUTES = [1, 5, 30, 120, 360];

/**
 * Durable outbound webhooks: emit() persists one delivery row per matching
 * integration (the outbox), then tries to deliver immediately. Failed
 * deliveries are retried by a 1-minute cron with exponential backoff until
 * DELIVERED or the attempt budget is exhausted (FAILED).
 * Payloads are HMAC-SHA256-signed (X-Pulsar-Signature) when a secret is set.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(private readonly prisma: PrismaService) {}

  async emit(tenantId: string, event: string, data: Record<string, unknown>): Promise<void> {
    const hooks = await this.prisma.integration.findMany({
      where: { tenantId, status: 'ENABLED', key: { startsWith: 'webhook' } },
    });
    const matching = hooks.filter((hook) => {
      const config = hook.config as WebhookConfig;
      if (!config.url) return false;
      return !config.events || config.events.length === 0 || config.events.includes(event);
    });
    if (matching.length === 0) return;

    const deliveries = await this.prisma.$transaction(
      matching.map((hook) =>
        this.prisma.webhookDelivery.create({
          data: {
            tenantId,
            integrationId: hook.id,
            event,
            payload: {
              event,
              occurredAt: new Date().toISOString(),
              data,
            } as Prisma.InputJsonValue,
          },
        }),
      ),
    );

    // First attempt inline; failures fall back to the cron.
    await Promise.allSettled(deliveries.map((d) => this.attempt(d.id)));
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async retryDueDeliveries(): Promise<void> {
    const due = await this.prisma.webhookDelivery.findMany({
      where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
      orderBy: { nextAttemptAt: 'asc' },
      take: 20,
      select: { id: true },
    });
    for (const delivery of due) {
      await this.attempt(delivery.id);
    }
  }

  async attempt(deliveryId: string): Promise<void> {
    const delivery = await this.prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
      include: { integration: true },
    });
    if (!delivery || delivery.status !== 'PENDING') return;

    const config = delivery.integration.config as WebhookConfig;
    const body = JSON.stringify(delivery.payload);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Pulsar-Delivery': delivery.id,
      'X-Pulsar-Event': delivery.event,
    };
    if (config.secret) {
      headers['X-Pulsar-Signature'] =
        'sha256=' + createHmac('sha256', config.secret).update(body).digest('hex');
    }

    try {
      const response = await fetch(config.url!, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await this.prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: 'DELIVERED', deliveredAt: new Date(), attempts: delivery.attempts + 1 },
      });
    } catch (err) {
      const attempts = delivery.attempts + 1;
      const exhausted = attempts >= MAX_ATTEMPTS;
      if (exhausted) {
        this.logger.warn(
          `Webhook delivery ${delivery.id} (${delivery.event}) failed permanently: ${String(err)}`,
        );
      }
      await this.prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          attempts,
          lastError: String(err).slice(0, 500),
          status: exhausted ? 'FAILED' : 'PENDING',
          nextAttemptAt: new Date(
            Date.now() + (BACKOFF_MINUTES[attempts - 1] ?? 360) * 60_000,
          ),
        },
      });
    }
  }
}
