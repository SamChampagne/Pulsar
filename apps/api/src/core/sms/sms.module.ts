import { Module } from '@nestjs/common';
import { CryptoModule } from '../crypto/crypto.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { SmsController, SmsWebhookController } from './sms.controller';
import { SmsWebhooksService } from './sms-webhooks.service';
import { SmsService } from './sms.service';
import { TelnyxTransport } from './telnyx.transport';
@Module({
  imports: [CryptoModule, AuditLogsModule],
  controllers: [SmsController, SmsWebhookController],
  providers: [SmsService, TelnyxTransport, SmsWebhooksService],
  exports: [SmsService],
})
export class SmsModule {}
