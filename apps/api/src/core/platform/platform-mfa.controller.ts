import { Controller, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PlatformController } from '../../common/decorators/platform-controller.decorator';
import { PlatformAuthService } from './platform-auth.service';

interface PlatformRequest {
  user: { id: string; email: string };
}

/**
 * Authenticated MFA management endpoints for platform admins.
 * @PlatformController() skips the global tenant guard and enforces PlatformGuard.
 */
@ApiTags('platform')
@ApiBearerAuth()
@PlatformController()
@Controller('platform/auth/mfa')
export class PlatformMfaController {
  constructor(private readonly auth: PlatformAuthService) {}

  /**
   * Start opt-in MFA enrollment for an already-authenticated platform admin.
   * Returns an enrollToken + otpauthUrl; the client confirms by calling
   * POST /platform/auth/mfa/enroll with the token and a TOTP code from the app.
   */
  @Post('enroll-start')
  enrollStart(@Req() req: PlatformRequest) {
    return this.auth.enrollStart(req.user.id, req.user.email);
  }
}
