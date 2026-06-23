import { Global, Module } from '@nestjs/common';
import { CryptoModule } from '../crypto/crypto.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { DocumentsModule } from '../documents/documents.module';
import { EmailService } from './email.service';
import { EmailConfigService } from './email-config.service';
import { EmailConfigController } from './email-config.controller';
import { MailService } from './mail.service';
import { EmailTemplatesService } from './email-templates.service';
import { TemplatesController } from './templates.controller';
import { AiDraftService } from './ai-draft.service';
import { EmailsService } from './emails.service';
import { EmailsController } from './emails.controller';

@Global()
@Module({
  imports: [CryptoModule, AuditLogsModule, DocumentsModule],
  controllers: [EmailConfigController, TemplatesController, EmailsController],
  providers: [
    EmailService,
    EmailConfigService,
    MailService,
    EmailTemplatesService,
    AiDraftService,
    EmailsService,
  ],
  exports: [EmailService, EmailConfigService, MailService, EmailTemplatesService, AiDraftService, EmailsService],
})
export class EmailModule {}
