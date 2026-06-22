import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CompaniesService } from './companies.service';
import { CompanyListQueryDto, CreateCompanyDto, UpdateCompanyDto } from './dto/company.dto';

@ApiTags('crm')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.CRM)
@Controller('crm/companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CRM.READ)
  list(@CurrentUser() user: AuthUser, @Query() query: CompanyListQueryDto) {
    return this.companies.list(user.tenantId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CRM.READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.companies.get(user.tenantId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCompanyDto) {
    return this.companies.create(user.tenantId, user.id, dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateCompanyDto) {
    return this.companies.update(user.tenantId, user.id, id, dto);
  }
}
