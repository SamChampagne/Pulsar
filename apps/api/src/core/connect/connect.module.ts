import { forwardRef, Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { DocumentsModule } from '../documents/documents.module';
import { CoreLocationsModule } from '../locations/locations.module';
import { OperatingModule } from '../operating/operating.module';
import { ModuleRegistryModule } from '../module-registry/module-registry.module';
import { TransportationModule } from '../../modules/transportation/transportation.module';
import { WmsModule } from '../../modules/wms/wms.module';
import { BillingModule } from '../../modules/billing/billing.module';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { InboundController } from './inbound.controller';
import { InboundService } from './inbound.service';

/**
 * ConnectModule — core ingestion surface (CSV importer + PDF/document inbound + inbox).
 *
 * DI graph:
 *  - PrismaService + SequencesService + TenantModulesCacheService: global (@Global PrismaModule)
 *  - DocumentsService: from DocumentsModule
 *  - AuditLogsService: from AuditLogsModule
 *  - DomainEventsService: from OperatingModule
 *  - ModuleSettingsService: from ModuleRegistryModule (csvNumberLocale for CSV parsing)
 *  - LocationsService: exported by CoreLocationsModule
 *  - CustomersService / CarriersService / VehiclesService / TrailersService:
 *    exported by TransportationModule
 *  - ItemsService: exported by WmsModule
 *  - FreightAuditService: exported by BillingModule (forwardRef to guard against potential
 *    future circular dep via OperatingModule ↔ AgentsModule chain)
 */
@Module({
  imports: [
    AuditLogsModule,
    DocumentsModule,
    CoreLocationsModule,
    OperatingModule,
    ModuleRegistryModule,
    TransportationModule,
    WmsModule,
    forwardRef(() => BillingModule),
  ],
  controllers: [ImportsController, InboundController],
  providers: [ImportsService, InboundService],
})
export class ConnectModule {}
