import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { FulfillmentService } from './fulfillment.service';

@ApiTags('wms/fulfillment')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.WMS)
@Controller('wms/fulfillment')
export class FulfillmentController {
  constructor(private readonly svc: FulfillmentService) {}

  @Get('pending')
  @RequirePermissions(PERMISSIONS.WMS.READ)
  pending(@CurrentUser() user: AuthUser) {
    return this.svc.pendingShipments(user.tenantId);
  }

  @Get('shipments/:id')
  @RequirePermissions(PERMISSIONS.WMS.READ)
  shipment(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.shipmentFulfillment(user.tenantId, id);
  }
}
