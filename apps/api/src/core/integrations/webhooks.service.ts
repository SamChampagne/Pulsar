import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@pulsar/database';
import {
  formatWebhookBody,
  resolveWebhookFormat,
  resolveWebhookTarget,
  type WebhookFormat,
} from '@pulsar/shared';
import { createHmac } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import { WebhookTransportService } from './webhook-transport.service';

interface WebhookConfig {
  /** Outbox spelling. The studio UI writes `endpointUrl`/`webhookSecret` instead —
   *  both are read through `resolveWebhookTarget` (@pulsar/shared). */
  url?: string;
  secret?: string;
  endpointUrl?: string;
  webhookSecret?: string;
  /** Event allowlist, e.g. ["load.dispatched", "tender.accepted"]. Empty/absent = all. */
  events?: string[];
  /** Wire format of the body: json (default) | slack | teams | x12. */
  format?: WebhookFormat;
}

/** Outcome of a one-shot connectivity probe (POST /integrations/:id/test). */
export interface WebhookPingResult {
  ok: boolean;
  statusCode?: number;
  latencyMs: number;
  error?: string;
}

const MAX_ATTEMPTS = 5;
const BACKOFF_MINUTES = [1, 5, 30, 120, 360];

/**
 * Durable outbound webhooks: emit() persists one delivery row per matching
 * integration (the outbox), then tries to deliver immediately. Failed
 * deliveries are retried by a 1-minute cron with exponential backoff until
 * DELIVERED or the attempt budget is exhausted (FAILED).
 * Payloads are HMAC-SHA256-signed (X-Pulsar-Signature) when a secret is set.
 *
 * Feed: every business event persisted by DomainEventsService is bridged here
 * (rule 55) — the outbox is the single path from domain events to integrations.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly transport: WebhookTransportService,
  ) {}

  async emit(tenantId: string, event: string, data: Record<string, unknown>): Promise<void> {
    const hooks = await this.prisma.integration.findMany({
      where: { tenantId, status: 'ENABLED', key: { startsWith: 'webhook' } },
    });
    const matching = hooks.filter((hook) => {
      const config = this.crypto.decryptJson<WebhookConfig>(hook.config);
      if (!resolveWebhookTarget(config)) return false;
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

  /**
   * Queues ONE delivery on a specific integration, bypassing the `webhook*` key
   * filter and the event allowlist of {@link emit}.
   *
   * Used by push surfaces that address a named partner rather than broadcasting
   * a domain event — today the outbound EDI 214 (`edi-*` integration, format
   * `x12`). Everything after the row is the ordinary outbox: same signing, same
   * formatting, same retry cron. Tenant-scoped (rule 1): an integration of
   * another tenant is a plain error, never a delivery.
   */
  async emitToIntegration(
    tenantId: string,
    integrationId: string,
    event: string,
    data: Record<string, unknown>,
  ): Promise<{ id: string }> {
    const integration = await this.prisma.integration.findFirst({
      where: { id: integrationId, tenantId, status: 'ENABLED' },
      select: { id: true },
    });
    if (!integration) throw new NotFoundException('Integration not found');
    const delivery = await this.prisma.webhookDelivery.create({
      data: {
        tenantId,
        integrationId: integration.id,
        event,
        payload: {
          event,
          occurredAt: new Date().toISOString(),
          data,
        } as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    // First attempt inline; a failure falls back to the retry cron.
    await this.attempt(delivery.id).catch((err) =>
      this.logger.warn(`Inline attempt of ${delivery.id} failed: ${String(err)}`),
    );
    return delivery;
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async retryDueDeliveries(): Promise<void> {
    const due = await this.prisma.webhookDelivery.findMany({
      where: {
        status: 'PENDING',
        nextAttemptAt: { lte: new Date() },
        integration: { status: 'ENABLED' },
      },
      orderBy: { nextAttemptAt: 'asc' },
      take: 20,
      select: { id: true },
    });
    for (const delivery of due) {
      await this.attempt(delivery.id);
    }
  }

  /** Signed headers for one body (signature only when a secret is configured). */
  private signedHeaders(
    secret: string | undefined,
    contentType: string,
    body: string,
    deliveryId: string,
    event: string,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'X-Pulsar-Delivery': deliveryId,
      'X-Pulsar-Event': event,
    };
    if (secret) {
      headers['X-Pulsar-Signature'] =
        'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
    }
    return headers;
  }

  async attempt(deliveryId: string): Promise<void> {
    const delivery = await this.prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
      include: { integration: true },
    });
    if (!delivery || delivery.status !== 'PENDING') return;
    // An operator disabling a connection also pauses its queued retries.
    if (delivery.integration.status !== 'ENABLED') return;

    const config = this.crypto.decryptJson<WebhookConfig>(delivery.integration.config);
    const target = resolveWebhookTarget(config);
    if (!target) {
      await this.prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          attempts: delivery.attempts + 1,
          status: 'FAILED',
          lastError: 'No destination URL configured',
        },
      });
      return;
    }
    const envelope = (delivery.payload ?? {}) as { occurredAt?: string; data?: unknown };
    const { body, contentType } = formatWebhookBody(
      delivery.event,
      envelope.data ?? {},
      resolveWebhookFormat(config.format),
      {
        deliveryId: delivery.id,
        occurredAt: envelope.occurredAt ?? delivery.createdAt.toISOString(),
      },
    );
    const headers = this.signedHeaders(
      target.secret,
      contentType,
      body,
      delivery.id,
      delivery.event,
    );

    try {
      const response = await this.transport.post(target.url, headers, body);
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
          nextAttemptAt: new Date(Date.now() + (BACKOFF_MINUTES[attempts - 1] ?? 360) * 60_000),
        },
      });
    }
  }

  /**
   * One-shot signed `ping` against the configured URL — the real connection test
   * for `webhook*` integrations. Never throws: transport failures come back as
   * `{ ok: false, error }`.
   */
  async ping(config: WebhookConfig): Promise<WebhookPingResult> {
    const startedAt = Date.now();
    const target = resolveWebhookTarget(config);
    if (!target) {
      return { ok: false, latencyMs: 0, error: 'Aucune URL configurée.' };
    }
    const { body, contentType } = formatWebhookBody(
      'ping',
      {},
      resolveWebhookFormat(config.format),
      { deliveryId: 'test', occurredAt: new Date().toISOString() },
    );
    const headers = this.signedHeaders(target.secret, contentType, body, 'test', 'ping');
    try {
      const response = await this.transport.post(target.url, headers, body);
      return {
        ok: response.ok,
        statusCode: response.status,
        latencyMs: Date.now() - startedAt,
        ...(response.ok ? {} : { error: `HTTP ${response.status}` }),
      };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        error: String(err instanceof Error ? err.message : err).slice(0, 300),
      };
    }
  }
}
