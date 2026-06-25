import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../../core/audit-logs/audit-logs.module';
import { OperatingModule } from '../../core/operating/operating.module';
import { PagesController } from './pages.controller';
import { SitesService } from './sites.service';
import { SitesPublicController } from './sites.public.controller';
import { SitesPublicService } from './sites.public.service';

/**
 * Sites module — landing pages (admin CRUD + publish + submissions + public API).
 * PrismaService + TenantModulesCacheService come from the @Global() PrismaModule.
 * OperatingModule provides DomainEventsService (best-effort lead event).
 * No static CrmModule import: contact dedup/create via direct PrismaService;
 * list-add via ModuleRef.get(ListsService, { strict: false }) inside try/catch.
 */
@Module({
  imports: [AuditLogsModule, OperatingModule],
  controllers: [PagesController, SitesPublicController],
  providers: [SitesService, SitesPublicService],
  exports: [SitesService],
})
export class SitesModule {}
