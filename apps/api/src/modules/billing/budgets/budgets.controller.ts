import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { BudgetsService } from './budgets.service';
import { CreateBudgetDto, UpdateBudgetDto } from './dto/budget.dto';

@ApiTags('billing')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.BILLING)
@Controller('billing/budgets')
export class BudgetsController {
  constructor(private readonly budgets: BudgetsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.BILLING.LEDGER_READ)
  list(@CurrentUser() user: AuthUser) {
    return this.budgets.list(user.tenantId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.BILLING.LEDGER_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateBudgetDto) {
    return this.budgets.create(user.tenantId, dto);
  }

  @Get(':id/variance')
  @RequirePermissions(PERMISSIONS.BILLING.LEDGER_READ)
  variance(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.budgets.variance(user.tenantId, id);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.BILLING.LEDGER_READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.budgets.get(user.tenantId, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.BILLING.LEDGER_MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateBudgetDto) {
    return this.budgets.update(user.tenantId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.BILLING.LEDGER_MANAGE)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.budgets.remove(user.tenantId, id);
  }
}
