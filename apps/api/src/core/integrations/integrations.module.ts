import { Module } from '@nestjs/common';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { WebhooksService } from './webhooks.service';

@Module({
  controllers: [IntegrationsController],
  providers: [IntegrationsService, WebhooksService],
  exports: [WebhooksService],
})
export class IntegrationsModule {}
