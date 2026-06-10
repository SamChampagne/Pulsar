import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { AuditAction, MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Audit } from '../../../common/decorators/audit.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { CreateCarrierDto, UpdateCarrierDto } from './dto/carrier.dto';
import { CarriersService } from './carriers.service';

@ApiTags('transportation/carriers')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.TRANSPORTATION)
@Controller('transportation/carriers')
export class CarriersController {
  constructor(private readonly carriers: CarriersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.MASTER_DATA_READ)
  list(@CurrentUser() user: AuthUser, @Query() query: ListQueryDto) {
    return this.carriers.list(user.tenantId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.MASTER_DATA_READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.carriers.get(user.tenantId, id);
  }

  @Post()
  @Audit('carrier', AuditAction.CREATE)
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.MASTER_DATA_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCarrierDto) {
    return this.carriers.create(user.tenantId, dto);
  }

  @Patch(':id')
  @Audit('carrier', AuditAction.UPDATE)
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.MASTER_DATA_MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateCarrierDto) {
    return this.carriers.update(user.tenantId, id, dto);
  }
}
