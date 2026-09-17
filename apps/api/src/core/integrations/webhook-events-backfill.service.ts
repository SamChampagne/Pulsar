import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { LEGACY_WEBHOOK_EVENTS } from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';

interface StoredWebhookConfig {
  events?: unknown;
  eventsBackfilledAt?: string;
  [key: string]: unknown;
}

/**
 * One-off, idempotent backfill of `config.events` on pre-existing `webhook*`
 * integrations.
 *
 * Before the domain-event bridge, an empty allowlist meant "the 6 TMS events
 * the outbox actually emitted". It now means "every event of the catalog"
 * (~30 types, some carrying customer data), which would silently widen the
 * egress of integrations configured under the old semantics. Rows without an
 * explicit allowlist therefore get the legacy list pinned.
 *
 * Why a boot hook and not a SQL migration: `Integration.config` holds an
 * AES-256-GCM ciphertext (`enc:v1:…`, CryptoService) — SQL cannot read, let
 * alone rewrite, the JSON inside it.
 *
 * Idempotent: a row is touched at most once, marked by `config.eventsBackfilledAt`.
 * Best-effort: any failure is logged, never fatal (same posture as
 * PermissionsSyncService).
 */
@Injectable()
export class WebhookEventsBackfillService implements OnApplicationBootstrap {
  private readonly logger = new Logger(WebhookEventsBackfillService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async onApplicationBootstrap() {
    try {
      const count = await this.backfill();
      if (count > 0) {
        this.logger.log(`Webhook event allowlists backfilled on ${count} integration(s)`);
      }
    } catch (err) {
      this.logger.error(
        `Webhook events backfill failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Returns how many integrations were updated. */
  async backfill(): Promise<number> {
    const rows = await this.prisma.integration.findMany({
      where: { key: { startsWith: 'webhook' } },
      select: { id: true, config: true },
    });

    let updated = 0;
    for (const row of rows) {
      let config: StoredWebhookConfig;
      try {
        config = this.crypto.decryptJson<StoredWebhookConfig>(row.config);
      } catch (err) {
        this.logger.warn(`Integration ${row.id}: unreadable config, skipped (${String(err)})`);
        continue;
      }
      if (config.eventsBackfilledAt) continue;
      const events = config.events;
      const hasAllowlist = Array.isArray(events) && events.length > 0;
      if (hasAllowlist) continue;

      const next: StoredWebhookConfig = {
        ...config,
        events: [...LEGACY_WEBHOOK_EVENTS],
        eventsBackfilledAt: new Date().toISOString(),
      };
      await this.prisma.integration.update({
        where: { id: row.id },
        data: { config: this.crypto.encryptJson(next) as Prisma.InputJsonValue },
      });
      updated++;
    }
    return updated;
  }
}
