import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { DocumentsModule } from '../documents/documents.module';
import { OperatingModule } from '../operating/operating.module';
import { TransportationModule } from '../../modules/transportation/transportation.module';
import { WmsModule } from '../../modules/wms/wms.module';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

/**
 * ConnectModule — core ingestion surface (CSV importer, future: inbox/PDF).
 *
 * DI graph:
 *  - PrismaService + SequencesService: global (@Global PrismaModule, no import needed)
 *  - DocumentsService: from DocumentsModule
 *  - AuditLogsService: from AuditLogsModule
 *  - DomainEventsService: from OperatingModule
 *  - CustomersService / LocationsService / CarriersService / VehiclesService / TrailersService:
 *    exported by TransportationModule
 *  - ItemsService: exported by WmsModule
 */
@Module({
  imports: [AuditLogsModule, DocumentsModule, OperatingModule, TransportationModule, WmsModule],
  controllers: [ImportsController],
  providers: [ImportsService],
})
export class ConnectModule {}
