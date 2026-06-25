import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { FinancialReportsService } from './financial-reports.service';

function parseDate(q: string | undefined): Date | undefined {
  if (!q) return undefined;
  const d = new Date(q);
  if (isNaN(d.getTime())) throw new BadRequestException(`Invalid date: ${q}`);
  return d;
}

@ApiTags('billing')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.BILLING)
@Controller('billing/reports')
export class ReportsController {
  constructor(private readonly reports: FinancialReportsService) {}

  @Get('profit-and-loss')
  @RequirePermissions(PERMISSIONS.BILLING.LEDGER_READ)
  profitAndLoss(
    @CurrentUser() user: AuthUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reports.profitAndLoss(user.tenantId, parseDate(from), parseDate(to));
  }

  @Get('balance-sheet')
  @RequirePermissions(PERMISSIONS.BILLING.LEDGER_READ)
  balanceSheet(
    @CurrentUser() user: AuthUser,
    @Query('asOf') asOf?: string,
  ) {
    return this.reports.balanceSheet(user.tenantId, parseDate(asOf));
  }

  @Get('cash-flow')
  @RequirePermissions(PERMISSIONS.BILLING.LEDGER_READ)
  cashFlow(
    @CurrentUser() user: AuthUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reports.cashFlow(user.tenantId, parseDate(from), parseDate(to));
  }
}
