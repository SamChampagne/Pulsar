import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { EmailConfigService } from '../email-config.service';
import { InboundIngestService } from './inbound-ingest.service';
import { INBOUND_EMAIL_DRIVER, type InboundEmailDriver } from './inbound-driver';

@Injectable()
export class InboundEmailService {
  private readonly logger = new Logger(InboundEmailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: EmailConfigService,
    private readonly ingest: InboundIngestService,
    @Inject(INBOUND_EMAIL_DRIVER) private readonly driver: InboundEmailDriver,
  ) {}

  /** Cron: poll every tenant with inbound active. Best-effort, never throws, isolated per tenant. */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async pollAllTenants(): Promise<void> {
    try {
      const tenants = await this.prisma.tenantEmailConfig.findMany({
        where: { inboundActive: true, imapHost: { not: null } },
        select: { tenantId: true },
      });
      for (const { tenantId } of tenants) {
        await this.pollTenant(tenantId).catch((err) =>
          this.logger.warn(`inbound poll failed for tenant ${tenantId}: ${String(err)}`),
        );
      }
    } catch (err) {
      this.logger.error(`pollAllTenants error: ${String(err)}`);
    }
  }

  async pollTenant(tenantId: string): Promise<void> {
    const config = await this.configService.resolveInbound(tenantId);
    if (!config) return;
    let ok = true;
    try {
      const messages = await this.driver.fetchNew(config);
      for (const raw of messages) {
        await this.ingest.ingest(tenantId, raw).catch((err) =>
          this.logger.warn(`ingest failed for tenant ${tenantId}: ${String(err)}`),
        );
      }
    } catch (err) {
      ok = false;
      this.logger.warn(`fetchNew failed for tenant ${tenantId}: ${String(err)}`);
    }
    await this.prisma.tenantEmailConfig
      .update({ where: { tenantId }, data: { lastPollAt: new Date(), lastPollOk: ok } })
      .catch(() => undefined);
  }
}
