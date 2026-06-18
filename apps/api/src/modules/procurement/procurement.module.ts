import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../../core/audit-logs/audit-logs.module';
import { RatesService } from '../transportation/rates/rates.service';
import { PublicBidsController } from './public-bids.controller';
import { ProcurementService } from './procurement.service';
import { RfpsController } from './rfps.controller';

/**
 * Procurement / Bid Board module.
 * RFP lifecycle, lane scoping, carrier invitations (tokenised), bid collection,
 * award (optionally creates a Rate) and routing-guide derivation.
 *
 * PrismaService, SequencesService, OwnershipService and TenantModulesCacheService
 * all come from the @Global() PrismaModule.
 * EmailService comes from the @Global() EmailModule.
 * RatesService is declared locally (it only requires the two global services).
 * AuditLogsService comes from the imported AuditLogsModule.
 */
@Module({
  imports: [AuditLogsModule],
  controllers: [RfpsController, PublicBidsController],
  providers: [ProcurementService, RatesService],
  exports: [ProcurementService],
})
export class ProcurementModule {}
