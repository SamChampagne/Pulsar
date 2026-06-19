import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { OnboardingService } from './onboarding.service';

@ApiTags('core/onboarding')
@ApiBearerAuth()
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  /** Read-only onboarding checklist computed from the tenant's live state. */
  @Get('status')
  @RequirePermissions(PERMISSIONS.CORE.MODULES_READ)
  getStatus(@CurrentUser() user: AuthUser) {
    return this.onboarding.getStatus(user.tenantId);
  }
}
