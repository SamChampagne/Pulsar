import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS, TaxTemplateType } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CreateTaxTemplateDto, UpdateTaxTemplateDto } from './dto/tax-template.dto';
import { TaxTemplatesService } from './tax-templates.service';

@ApiTags('billing')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.BILLING)
@Controller('billing/tax-templates')
export class TaxTemplatesController {
  constructor(private readonly service: TaxTemplatesService) {}

  @Get() @RequirePermissions(PERMISSIONS.BILLING.TAXES_READ)
  list(@CurrentUser() user: AuthUser, @Query('type') type?: TaxTemplateType) {
    return this.service.list(user.tenantId, type);
  }

  @Get(':id') @RequirePermissions(PERMISSIONS.BILLING.TAXES_READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.get(user.tenantId, id);
  }

  @Post() @RequirePermissions(PERMISSIONS.BILLING.TAXES_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTaxTemplateDto) {
    return this.service.create(user.tenantId, dto);
  }

  @Patch(':id') @RequirePermissions(PERMISSIONS.BILLING.TAXES_MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateTaxTemplateDto) {
    return this.service.update(user.tenantId, id, dto);
  }

  @Delete(':id') @RequirePermissions(PERMISSIONS.BILLING.TAXES_MANAGE)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.tenantId, id);
  }
}
