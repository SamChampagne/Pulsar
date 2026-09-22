import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../../core/audit-logs/audit-logs.module';
import { QualityController } from './quality.controller';
import { QualityService } from './quality.service';
import { DocumentsModule } from '../../core/documents/documents.module';
@Module({
  imports: [AuditLogsModule, DocumentsModule],
  controllers: [QualityController],
  providers: [QualityService],
})
export class QualityModule {}
