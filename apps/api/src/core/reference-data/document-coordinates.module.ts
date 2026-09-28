import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { DocumentCoordinatesService } from './document-coordinates.service';
import { DocumentCoordinatesControllers } from './document-coordinates.controllers';
@Module({
  imports: [AuditLogsModule],
  providers: [DocumentCoordinatesService],
  controllers: DocumentCoordinatesControllers,
  exports: [DocumentCoordinatesService],
})
export class DocumentCoordinatesModule {}
