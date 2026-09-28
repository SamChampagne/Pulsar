import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CryptoModule } from '../crypto/crypto.module';
import { InboundHooksAdminController } from './inbound-hooks.admin.controller';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { WebhookEventsBackfillService } from './webhook-events-backfill.service';
import { WebhooksService } from './webhooks.service';
import { WebhookTransportService } from './webhook-transport.service';

@Module({
  imports: [CryptoModule, AuditLogsModule],
  controllers: [IntegrationsController, InboundHooksAdminController],
  providers: [
    IntegrationsService,
    WebhooksService,
    WebhookEventsBackfillService,
    WebhookTransportService,
  ],
  exports: [WebhooksService],
})
export class IntegrationsModule {}
