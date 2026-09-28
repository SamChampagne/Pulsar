import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MODULE_KEYS, PERMISSIONS, type AuthUser } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { AccountingProfileService } from './accounting-profile.service';
import { AccountingProfileDto } from './accounting-profile.dto';
@ApiTags('billing')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.BILLING)
@Controller('billing/accounting-profile')
export class AccountingProfileController {
  constructor(private readonly profiles: AccountingProfileService) {}
  @Get()
  @RequirePermissions(PERMISSIONS.BILLING.LEDGER_READ)
  get(@CurrentUser() user: AuthUser) {
    return this.profiles.get(user.tenantId);
  }
  @Put()
  @RequirePermissions(PERMISSIONS.BILLING.LEDGER_READ, PERMISSIONS.BILLING.ACCOUNTING_CONFIGURE)
  save(@CurrentUser() user: AuthUser, @Body() dto: AccountingProfileDto) {
    return this.profiles.save(user, dto);
  }
}
