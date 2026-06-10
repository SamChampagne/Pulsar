import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { AuditAction, MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Audit } from '../../../common/decorators/audit.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { CreateRateDto, UpdateRateDto } from './dto/rate.dto';
import { RatesService } from './rates.service';

@ApiTags('transportation/rates')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.TRANSPORTATION)
@Controller('transportation/rates')
export class RatesController {
  constructor(private readonly rates: RatesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.RATES_READ)
  list(@CurrentUser() user: AuthUser, @Query() query: ListQueryDto) {
    return this.rates.list(user.tenantId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.RATES_READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.rates.get(user.tenantId, id);
  }

  @Post()
  @Audit('rate', AuditAction.CREATE)
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.RATES_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRateDto) {
    return this.rates.create(user.tenantId, dto);
  }

  @Patch(':id')
  @Audit('rate', AuditAction.UPDATE)
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.RATES_MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateRateDto) {
    return this.rates.update(user.tenantId, id, dto);
  }
}
