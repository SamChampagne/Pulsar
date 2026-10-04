import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MODULE_KEYS, PERMISSIONS, type AuthUser } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import {
  CreateDeliveryExceptionDto,
  DeliveryExceptionQuery,
  TransitionDeliveryExceptionDto,
} from './delivery-exceptions.dto';
import { DeliveryExceptionsService } from './delivery-exceptions.service';

@ApiTags('transportation/delivery-exceptions')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.TRANSPORTATION)
@Controller('transportation/delivery-exceptions')
export class DeliveryExceptionsController {
  constructor(private readonly service: DeliveryExceptionsService) {}
  @Get()
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_READ)
  list(@CurrentUser() user: AuthUser, @Query() query: DeliveryExceptionQuery) {
    return this.service.list(user.tenantId, query.loadId);
  }
  @Post()
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.EXECUTION_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateDeliveryExceptionDto) {
    return this.service.create(user.tenantId, user.id, dto);
  }
  @Post(':id/transition')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.EXECUTION_MANAGE)
  transition(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: TransitionDeliveryExceptionDto,
  ) {
    return this.service.transition(user.tenantId, user.id, id, dto);
  }
}
