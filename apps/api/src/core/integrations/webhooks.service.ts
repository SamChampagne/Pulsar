import { Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';

interface WebhookConfig {
  url?: string;
  secret?: string;
  /** Event allowlist, e.g. ["load.dispatched", "tender.accepted"]. Empty/absent = all. */
  events?: string[];
}

/**
 * Outbound webhooks v0: fire-and-forget POSTs to integrations whose key starts
 * with "webhook" (status ENABLED). Payloads are signed with HMAC-SHA256 in the
 * X-Pulsar-Signature header when a secret is configured.
 * TODO(phase-3): durable outbox with retries instead of fire-and-forget.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(private readonly prisma: PrismaService) {}

  async emit(tenantId: string, event: string, data: Record<string, unknown>): Promise<void> {
    const hooks = await this.prisma.integration.findMany({
      where: { tenantId, status: 'ENABLED', key: { startsWith: 'webhook' } },
    });

    const body = JSON.stringify({ event, occurredAt: new Date().toISOString(), data });
    await Promise.allSettled(
      hooks.map(async (hook) => {
        const config = hook.config as WebhookConfig;
        if (!config.url) return;
        if (config.events && config.events.length > 0 && !config.events.includes(event)) return;

        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (config.secret) {
          headers['X-Pulsar-Signature'] =
            'sha256=' + createHmac('sha256', config.secret).update(body).digest('hex');
        }
        try {
          await fetch(config.url, {
            method: 'POST',
            headers,
            body,
            signal: AbortSignal.timeout(5000),
          });
        } catch (err) {
          this.logger.warn(`Webhook "${hook.key}" (${event}) failed: ${String(err)}`);
        }
      }),
    );
  }
}
