import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../../core/audit-logs/audit-logs.module';
import { ItemsService } from './items/items.service';
import { ItemsController } from './items/items.controller';
import { BinsService } from './bins/bins.service';
import { BinsController } from './bins/bins.controller';
import { InventoryService } from './inventory/inventory.service';
import { InventoryController } from './inventory/inventory.controller';
import { ReceivingService } from './receiving/receiving.service';
import { ReceivingController } from './receiving/receiving.controller';
import { PickingService } from './picking/picking.service';
import { PickingController } from './picking/picking.controller';
import { WmsOverviewService } from './overview/wms-overview.service';
import { WmsOverviewController } from './overview/wms-overview.controller';

/**
 * Light WMS module (items + bins + inventory + receiving + picking + overview).
 * Every controller is gated by @RequireModule(MODULE_KEYS.WMS): tenants without
 * the module enabled get a 403 from ModulesGuard.
 *
 * PrismaService, OwnershipService and SequencesService all come from the
 * @Global() PrismaModule; AuditLogsService comes from the imported
 * AuditLogsModule (same pattern as FleetModule / TransportationModule).
 * ReceivingService/PickingService depend on InventoryService — same module,
 * so it resolves from providers.
 */
@Module({
  imports: [AuditLogsModule],
  controllers: [
    ItemsController,
    BinsController,
    InventoryController,
    ReceivingController,
    PickingController,
    WmsOverviewController,
  ],
  providers: [
    ItemsService,
    BinsService,
    InventoryService,
    ReceivingService,
    PickingService,
    WmsOverviewService,
  ],
})
export class WmsModule {}
