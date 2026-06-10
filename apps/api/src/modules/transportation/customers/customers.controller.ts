import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { AuditAction, MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Audit } from '../../../common/decorators/audit.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';
import { CustomersService } from './customers.service';

@ApiTags('transportation/customers')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.TRANSPORTATION)
@Controller('transportation/customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.MASTER_DATA_READ)
  list(@CurrentUser() user: AuthUser, @Query() query: ListQueryDto) {
    return this.customers.list(user.tenantId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.MASTER_DATA_READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.customers.get(user.tenantId, id);
  }

  @Post()
  @Audit('customer', AuditAction.CREATE)
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.MASTER_DATA_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCustomerDto) {
    return this.customers.create(user.tenantId, dto);
  }

  @Patch(':id')
  @Audit('customer', AuditAction.UPDATE)
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.MASTER_DATA_MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    return this.customers.update(user.tenantId, id, dto);
  }
}
