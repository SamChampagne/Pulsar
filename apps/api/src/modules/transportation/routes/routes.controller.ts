import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS, StopStatus } from '@pulsar/shared';
import { IsEnum } from 'class-validator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { CreateRouteDto } from './dto/route.dto';
import { RoutesService } from './routes.service';

class UpdateStopStatusDto {
  @IsEnum(StopStatus)
  status!: StopStatus;
}

@ApiTags('transportation/routes')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.TRANSPORTATION)
@Controller('transportation/routes')
export class RoutesController {
  constructor(private readonly routes: RoutesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_READ)
  list(@CurrentUser() user: AuthUser, @Query() query: ListQueryDto) {
    return this.routes.list(user.tenantId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.routes.get(user.tenantId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRouteDto) {
    return this.routes.createForLoad(user.tenantId, dto, user.id);
  }

  @Post('preview')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_MANAGE)
  preview(@CurrentUser() user: AuthUser, @Body() dto: CreateRouteDto) {
    return this.routes.preview(user.tenantId, dto);
  }

  @Post('stops/:stopId/status')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.EXECUTION_MANAGE)
  updateStopStatus(
    @CurrentUser() user: AuthUser,
    @Param('stopId') stopId: string,
    @Body() dto: UpdateStopStatusDto,
  ) {
    return this.routes.updateStopStatus(user.tenantId, stopId, dto.status, user.id);
  }
}
