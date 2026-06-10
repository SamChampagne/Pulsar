import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { ArrayMinSize, IsArray, IsString } from 'class-validator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { LanesService } from './lanes.service';

class SetLaneDto {
  @IsString()
  originLocationId!: string;

  @IsString()
  destinationLocationId!: string;

  /** Ordered by preference — first carrier is tendered first. */
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  carrierIds!: string[];
}

@ApiTags('transportation/lanes')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.TRANSPORTATION)
@Controller('transportation/lanes')
export class LanesController {
  constructor(private readonly lanes: LanesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.MASTER_DATA_READ)
  list(
    @CurrentUser() user: AuthUser,
    @Query('originLocationId') originLocationId?: string,
    @Query('destinationLocationId') destinationLocationId?: string,
  ) {
    return this.lanes.list(user.tenantId, originLocationId, destinationLocationId);
  }

  @Put()
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.MASTER_DATA_MANAGE)
  setLane(@CurrentUser() user: AuthUser, @Body() dto: SetLaneDto) {
    return this.lanes.setLane(
      user.tenantId,
      dto.originLocationId,
      dto.destinationLocationId,
      dto.carrierIds,
    );
  }
}
