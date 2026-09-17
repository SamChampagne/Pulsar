import { forwardRef, Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CryptoModule } from '../crypto/crypto.module';
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
import { InboundHooksController } from './inbound-hooks.controller';
import { InboundHooksService } from './inbound-hooks.service';
import { ConnectRecordWriter } from './record-writer.service';

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
 *  - TransportOrdersService: exported by TransportationModule (inbound hook target)
 *  - CryptoService: from CryptoModule (inbound receivers read the encrypted config)
 *  - ApiKeysService: global (@Global ApiKeysModule) — tenant service account (rule 13)
 *  - FreightAuditService: exported by BillingModule (forwardRef to guard against potential
 *    future circular dep via OperatingModule ↔ AgentsModule chain)
 */
@Module({
  imports: [
    AuditLogsModule,
    CryptoModule,
    DocumentsModule,
    CoreLocationsModule,
    OperatingModule,
    ModuleRegistryModule,
    TransportationModule,
    WmsModule,
    forwardRef(() => BillingModule),
  ],
  controllers: [ImportsController, InboundController, InboundHooksController],
  providers: [ImportsService, InboundService, InboundHooksService, ConnectRecordWriter],
})
export class ConnectModule {}
