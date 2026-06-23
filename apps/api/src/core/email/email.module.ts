import { Global, Module } from '@nestjs/common';
import { CryptoModule } from '../crypto/crypto.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { DocumentsModule } from '../documents/documents.module';
import { EmailService } from './email.service';
import { EmailConfigService } from './email-config.service';
import { EmailConfigController } from './email-config.controller';
import { MailService } from './mail.service';

@Global()
@Module({
  imports: [CryptoModule, AuditLogsModule, DocumentsModule],
  controllers: [EmailConfigController],
  providers: [EmailService, EmailConfigService, MailService],
  exports: [EmailService, EmailConfigService, MailService],
})
export class EmailModule {}
