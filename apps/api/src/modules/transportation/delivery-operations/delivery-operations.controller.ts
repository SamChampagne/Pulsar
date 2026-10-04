import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MODULE_KEYS, PERMISSIONS, type AuthUser } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { DeliveryOperationsQuery } from './delivery-operations.dto';
import { DeliveryOperationsService } from './delivery-operations.service';

@ApiTags('transportation/delivery-operations')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.TRANSPORTATION)
@Controller('transportation/delivery-operations')
export class DeliveryOperationsController {
  constructor(private readonly operations: DeliveryOperationsService) {}
  @Get()
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_READ)
  list(@CurrentUser() user: AuthUser, @Query() query: DeliveryOperationsQuery) {
    return this.operations.list(user.tenantId, query);
  }
}
