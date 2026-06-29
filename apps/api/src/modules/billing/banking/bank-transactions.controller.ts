import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { BankTxnStatus, MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { BankTransactionsService } from './bank-transactions.service';
import { CreateBankTransactionDto, ImportBankCsvDto, MatchDto } from './dto/bank-transaction.dto';

@ApiTags('billing')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.BILLING)
@Controller('billing/bank-transactions')
export class BankTransactionsController {
  constructor(private readonly service: BankTransactionsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.BILLING.LEDGER_READ)
  list(
    @CurrentUser() user: AuthUser,
    @Query('bankAccountId') bankAccountId?: string,
    @Query('status') status?: BankTxnStatus,
  ) {
    return this.service.list(user.tenantId, bankAccountId, status);
  }

  // Declared BEFORE :id routes to avoid shadowing
  @Get('reconciliation')
  @RequirePermissions(PERMISSIONS.BILLING.LEDGER_READ)
  reconciliation(
    @CurrentUser() user: AuthUser,
    @Query('bankAccountId') bankAccountId: string,
  ) {
    return this.service.reconciliation(user.tenantId, bankAccountId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.BILLING.LEDGER_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateBankTransactionDto) {
    return this.service.create(user.tenantId, dto);
  }

  // Declared BEFORE :id/... routes to avoid shadowing
  @Post('import')
  @RequirePermissions(PERMISSIONS.BILLING.LEDGER_MANAGE)
  importCsv(@CurrentUser() user: AuthUser, @Body() dto: ImportBankCsvDto) {
    return this.service.import(user.tenantId, dto);
  }

  @Post(':id/match')
  @RequirePermissions(PERMISSIONS.BILLING.LEDGER_MANAGE)
  match(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: MatchDto) {
    return this.service.match(user.tenantId, user.id, id, dto.paymentId);
  }

  @Post(':id/unmatch')
  @RequirePermissions(PERMISSIONS.BILLING.LEDGER_MANAGE)
  unmatch(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.unmatch(user.tenantId, user.id, id);
  }
}
