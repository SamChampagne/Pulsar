import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { SubscriptionsService } from './subscriptions.service';
import { CreateSubscriptionDto, UpdateSubscriptionDto } from './dto/subscription.dto';

@ApiTags('billing')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.BILLING)
@Controller('billing/subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.BILLING.SUBSCRIPTIONS_READ)
  list(@CurrentUser() user: AuthUser) {
    return this.subscriptions.list(user.tenantId);
  }

  // run-due MUST be declared before :id routes so Nest doesn't match "run-due" as an id.
  @Post('run-due')
  @RequirePermissions(PERMISSIONS.BILLING.SUBSCRIPTIONS_MANAGE)
  runDue(@CurrentUser() user: AuthUser) {
    return this.subscriptions.runDue(user.tenantId, user.id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.BILLING.SUBSCRIPTIONS_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateSubscriptionDto) {
    return this.subscriptions.create(user.tenantId, user.id, dto);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.BILLING.SUBSCRIPTIONS_READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.subscriptions.get(user.tenantId, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.BILLING.SUBSCRIPTIONS_MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateSubscriptionDto) {
    return this.subscriptions.update(user.tenantId, user.id, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.BILLING.SUBSCRIPTIONS_MANAGE)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.subscriptions.remove(user.tenantId, user.id, id);
  }

  @Post(':id/pause')
  @RequirePermissions(PERMISSIONS.BILLING.SUBSCRIPTIONS_MANAGE)
  pause(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.subscriptions.pause(user.tenantId, user.id, id);
  }

  @Post(':id/resume')
  @RequirePermissions(PERMISSIONS.BILLING.SUBSCRIPTIONS_MANAGE)
  resume(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.subscriptions.resume(user.tenantId, user.id, id);
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.BILLING.SUBSCRIPTIONS_MANAGE)
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.subscriptions.cancel(user.tenantId, user.id, id);
  }

  @Post(':id/generate')
  @RequirePermissions(PERMISSIONS.BILLING.SUBSCRIPTIONS_MANAGE)
  generate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.subscriptions.generate(user.tenantId, user.id, id);
  }
}
