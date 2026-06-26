import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CreateModeOfPaymentDto, UpdateModeOfPaymentDto } from './dto/mode-of-payment.dto';
import { ModesOfPaymentService } from './modes-of-payment.service';

@ApiTags('billing')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.BILLING)
@Controller('billing/modes-of-payment')
export class ModesOfPaymentController {
  constructor(private readonly service: ModesOfPaymentService) {}

  @Get() @RequirePermissions(PERMISSIONS.BILLING.PAYMENTS_READ)
  list(@CurrentUser() user: AuthUser) { return this.service.list(user.tenantId); }

  @Post() @RequirePermissions(PERMISSIONS.BILLING.PAYMENTS_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateModeOfPaymentDto) { return this.service.create(user.tenantId, dto); }

  @Patch(':id') @RequirePermissions(PERMISSIONS.BILLING.PAYMENTS_MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateModeOfPaymentDto) { return this.service.update(user.tenantId, id, dto); }

  @Delete(':id') @RequirePermissions(PERMISSIONS.BILLING.PAYMENTS_MANAGE)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.service.remove(user.tenantId, id); }
}
