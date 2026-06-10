import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CreatePodDto, CreateTrackingEventDto } from './dto/tracking.dto';
import { TrackingService } from './tracking.service';

@ApiTags('transportation/tracking')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.TRANSPORTATION)
@Controller('transportation/tracking')
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  @Get('events')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.TRACKING_READ)
  listEvents(
    @CurrentUser() user: AuthUser,
    @Query('loadId') loadId?: string,
    @Query('shipmentId') shipmentId?: string,
  ) {
    return this.tracking.listEvents(user.tenantId, { loadId, shipmentId });
  }

  @Post('events')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.TRACKING_WRITE)
  createEvent(@CurrentUser() user: AuthUser, @Body() dto: CreateTrackingEventDto) {
    return this.tracking.createEvent(user.tenantId, user.id, dto);
  }

  @Post('pod')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.TRACKING_WRITE)
  createPod(@CurrentUser() user: AuthUser, @Body() dto: CreatePodDto) {
    return this.tracking.createPod(user.tenantId, user.id, dto);
  }

  @Get('pod/:shipmentId')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.TRACKING_READ)
  getPod(@CurrentUser() user: AuthUser, @Param('shipmentId') shipmentId: string) {
    return this.tracking.getPod(user.tenantId, shipmentId);
  }
}
