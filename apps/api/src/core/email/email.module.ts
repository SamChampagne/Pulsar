import { Global, Module } from '@nestjs/common';
import { CryptoModule } from '../crypto/crypto.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { EmailService } from './email.service';
import { EmailConfigService } from './email-config.service';
import { EmailConfigController } from './email-config.controller';

@Global()
@Module({
  imports: [CryptoModule, AuditLogsModule],
  controllers: [EmailConfigController],
  providers: [EmailService, EmailConfigService],
  exports: [EmailService, EmailConfigService],
})
export class EmailModule {}
