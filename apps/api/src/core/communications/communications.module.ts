import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { SmsModule } from '../sms/sms.module';
import { CommunicationContextService } from './communication-context.service';
import { CommunicationsService } from './communications.service';
import { CommunicationsController } from './communications.controller';
@Module({
  imports: [SmsModule, AuditLogsModule],
  controllers: [CommunicationsController],
  providers: [CommunicationContextService, CommunicationsService],
})
export class CommunicationsModule {}
