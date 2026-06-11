import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';

@Module({
  imports: [AuditLogsModule],
  controllers: [PlatformController],
  providers: [PlatformService],
})
export class PlatformModule {}
