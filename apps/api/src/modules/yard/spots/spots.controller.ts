import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { AuditAction, MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Audit } from '../../../common/decorators/audit.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CreateSpotDto, SpotListQueryDto, UpdateSpotDto } from './dto/spot.dto';
import { SpotsService } from './spots.service';

@ApiTags('yard/spots')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.YARD)
@Controller('yard/spots')
export class SpotsController {
  constructor(private readonly spots: SpotsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.YARD.READ)
  list(@CurrentUser() user: AuthUser, @Query() q: SpotListQueryDto) {
    return this.spots.list(user.tenantId, q);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.YARD.READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.spots.get(user.tenantId, id);
  }

  @Post()
  @Audit('yard-spot', AuditAction.CREATE)
  @RequirePermissions(PERMISSIONS.YARD.MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateSpotDto) {
    return this.spots.create(user.tenantId, dto);
  }

  @Patch(':id')
  @Audit('yard-spot', AuditAction.UPDATE)
  @RequirePermissions(PERMISSIONS.YARD.MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateSpotDto) {
    return this.spots.update(user.tenantId, id, dto);
  }
}
