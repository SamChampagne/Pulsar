import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../../core/audit-logs/audit-logs.module';
import { PagesController } from './pages.controller';
import { SitesService } from './sites.service';

/**
 * Sites module — landing pages (admin CRUD + publish + submissions).
 * Public controller/service come in Task 5 — the module is structured to accept them.
 * PrismaService comes from the @Global() PrismaModule (no explicit import needed).
 * No static CrmModule import: captureListId ownership uses PrismaService directly (cycle avoidance).
 */
@Module({
  imports: [AuditLogsModule],
  controllers: [PagesController],
  providers: [SitesService],
  exports: [SitesService],
})
export class SitesModule {}
