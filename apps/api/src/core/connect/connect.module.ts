import {
  forwardRef,
  Module,
  RequestMethod,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CryptoModule } from '../crypto/crypto.module';
import { DocumentsModule } from '../documents/documents.module';
import { IntegrationsModule } from '../integrations/integrations.module';
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
import { InboundHooksService, MAX_HOOK_BODY_BYTES } from './inbound-hooks.service';
import { ConnectRecordWriter } from './record-writer.service';
import { EdiController } from './edi.controller';
import { EdiShipmentsController } from './edi-shipments.controller';
import { EdiService, MAX_EDI_BYTES } from './edi.service';
import { rawTextBody } from './raw-text.middleware';

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
 *  - WebhooksService: exported by IntegrationsModule (outbound EDI 214 rides the outbox)
 */
@Module({
  imports: [
    AuditLogsModule,
    CryptoModule,
    DocumentsModule,
    IntegrationsModule,
    CoreLocationsModule,
    OperatingModule,
    ModuleRegistryModule,
    TransportationModule,
    WmsModule,
    forwardRef(() => BillingModule),
  ],
  controllers: [
    ImportsController,
    InboundController,
    InboundHooksController,
    EdiController,
    EdiShipmentsController,
  ],
  providers: [ImportsService, InboundService, InboundHooksService, ConnectRecordWriter, EdiService],
})
export class ConnectModule implements NestModule {
  /**
   * Nest only registers the JSON + urlencoded parsers, so an X12 interchange
   * posted as `text/plain` would arrive empty. Scoped to the two doors that can
   * receive one (the public receiver keeps its JSON behaviour untouched — the
   * middleware is a no-op once a parser has consumed the body).
   */
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(rawTextBody(MAX_EDI_BYTES))
      .forRoutes({ path: 'connect/edi/inbound', method: RequestMethod.POST })
      // The public door knows nothing about the integration before buffering,
      // so an anonymous caller gets the SAME ceiling as a JSON delivery.
      .apply(rawTextBody(MAX_HOOK_BODY_BYTES))
      .forRoutes({ path: 'public/hooks/:inboundToken', method: RequestMethod.POST });
  }
}
