import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { LoadStatus, MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { IsEnum, IsOptional } from 'class-validator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { AssignLoadResourcesDto, CreateLoadDto } from './dto/load.dto';
import { LoadsService } from './loads.service';

class LoadListQueryDto extends ListQueryDto {
  @IsOptional()
  @IsEnum(LoadStatus)
  status?: LoadStatus;
}

@ApiTags('transportation/loads')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.TRANSPORTATION)
@Controller('transportation/loads')
export class LoadsController {
  constructor(private readonly loads: LoadsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_READ)
  list(@CurrentUser() user: AuthUser, @Query() query: LoadListQueryDto) {
    return this.loads.list(user.tenantId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.loads.get(user.tenantId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateLoadDto) {
    return this.loads.create(user.tenantId, user.id, dto);
  }

  @Post(':id/assign')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_MANAGE)
  assign(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AssignLoadResourcesDto) {
    return this.loads.assignResources(user.tenantId, user.id, id, dto);
  }

  @Post(':id/dispatch')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.EXECUTION_MANAGE)
  dispatch(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.loads.dispatch(user.tenantId, user.id, id);
  }

  @Post(':id/start-transit')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.EXECUTION_MANAGE)
  startTransit(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.loads.startTransit(user.tenantId, user.id, id);
  }

  @Post(':id/complete')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.EXECUTION_MANAGE)
  complete(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.loads.complete(user.tenantId, user.id, id);
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.EXECUTION_MANAGE)
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.loads.cancel(user.tenantId, user.id, id);
  }
}
