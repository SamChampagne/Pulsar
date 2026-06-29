import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CryptoModule } from '../crypto/crypto.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { DocumentsModule } from '../documents/documents.module';
import { OperatingModule } from '../operating/operating.module';
import { EmailService } from './email.service';
import { EmailConfigService } from './email-config.service';
import { EmailConfigController } from './email-config.controller';
import { MailService } from './mail.service';
import { EmailTemplatesService } from './email-templates.service';
import { TemplatesController } from './templates.controller';
import { AiDraftService } from './ai-draft.service';
import { EmailsService } from './emails.service';
import { EmailsController } from './emails.controller';
import { InboundIngestService } from './inbound/inbound-ingest.service';
import { InboundEmailService } from './inbound/inbound-email.service';
import { InboundController } from './inbound/inbound.controller';
import { LogInboundDriver } from './inbound/log-inbound.driver';
import { ImapPollDriver } from './inbound/imap-poll.driver';
import { INBOUND_EMAIL_DRIVER } from './inbound/inbound-driver';

@Global()
@Module({
  imports: [CryptoModule, AuditLogsModule, DocumentsModule, OperatingModule],
  controllers: [EmailConfigController, TemplatesController, EmailsController, InboundController],
  providers: [
    EmailService,
    EmailConfigService,
    MailService,
    EmailTemplatesService,
    AiDraftService,
    EmailsService,
    InboundIngestService,
    InboundEmailService,
    LogInboundDriver,
    ImapPollDriver,
    {
      provide: INBOUND_EMAIL_DRIVER,
      useFactory: (cfg: ConfigService, log: LogInboundDriver, imap: ImapPollDriver) =>
        cfg.get('EMAIL_DRIVER', 'log') === 'smtp' ? imap : log,
      inject: [ConfigService, LogInboundDriver, ImapPollDriver],
    },
  ],
  exports: [
    EmailService,
    EmailConfigService,
    MailService,
    EmailTemplatesService,
    AiDraftService,
    EmailsService,
    InboundIngestService,
    INBOUND_EMAIL_DRIVER,
  ],
})
export class EmailModule {}
