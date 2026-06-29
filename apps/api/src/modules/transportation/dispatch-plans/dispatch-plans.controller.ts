import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { ArrayMinSize, IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { DispatchPlansService } from './dispatch-plans.service';

class DispatchPlanItemDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  shipmentIds!: string[];
}

class CreateDispatchPlanDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DispatchPlanItemDto)
  items!: DispatchPlanItemDto[];

  @IsOptional()
  @IsString()
  engine?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

@ApiTags('transportation')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.TRANSPORTATION)
@Controller('transportation/dispatch-plans')
export class DispatchPlansController {
  constructor(private readonly plans: DispatchPlansService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_READ)
  list(@CurrentUser() user: AuthUser, @Query() query: ListQueryDto) {
    return this.plans.list(user.tenantId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.plans.get(user.tenantId, id);
  }

  @Get(':id/diff')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_READ)
  diff(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.plans.diff(user.tenantId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateDispatchPlanDto) {
    return this.plans.create(user.tenantId, user.id, dto);
  }

  @Post(':id/propose')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_MANAGE)
  propose(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.plans.propose(user.tenantId, user.id, id);
  }

  @Post(':id/commit')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_MANAGE)
  commit(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.plans.commit(user.tenantId, user.id, id);
  }

  @Post(':id/discard')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_MANAGE)
  discard(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.plans.discard(user.tenantId, user.id, id);
  }
}
