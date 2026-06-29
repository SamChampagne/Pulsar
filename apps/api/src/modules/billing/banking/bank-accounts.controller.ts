import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { BankAccountsService } from './bank-accounts.service';
import { CreateBankAccountDto, UpdateBankAccountDto } from './dto/bank-account.dto';

@ApiTags('billing')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.BILLING)
@Controller('billing/bank-accounts')
export class BankAccountsController {
  constructor(private readonly service: BankAccountsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.BILLING.LEDGER_READ)
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user.tenantId);
  }

  @Get(':id/balance')
  @RequirePermissions(PERMISSIONS.BILLING.LEDGER_READ)
  balance(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.balance(user.tenantId, id);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.BILLING.LEDGER_READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.get(user.tenantId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.BILLING.LEDGER_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateBankAccountDto) {
    return this.service.create(user.tenantId, dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.BILLING.LEDGER_MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateBankAccountDto) {
    return this.service.update(user.tenantId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.BILLING.LEDGER_MANAGE)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.tenantId, id);
  }
}
