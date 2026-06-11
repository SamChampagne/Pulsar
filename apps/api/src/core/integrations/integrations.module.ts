import { Module } from '@nestjs/common';
import { CryptoModule } from '../crypto/crypto.module';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [CryptoModule],
  controllers: [IntegrationsController],
  providers: [IntegrationsService, WebhooksService],
  exports: [WebhooksService],
})
export class IntegrationsModule {}
