import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { PortalAuthUser } from '@pulsar/shared';
import { CurrentPortalUser } from '../../../common/decorators/current-portal-user.decorator';
import { PortalController } from '../../../common/decorators/portal-controller.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import {
  PortalForgotDto,
  PortalLoginDto,
  PortalRefreshDto,
  PortalResetDto,
} from '../dto/portal-auth.dto';
import { PortalAuthService } from './portal-auth.service';

/**
 * Unauthenticated door of the customer-portal plane. `@Public()` bypasses the
 * global tenant JwtAuthGuard — credentials and one-shot tokens do the gating —
 * and ThrottlerGuard caps brute force, exactly like `platform/auth`.
 */
@ApiTags('portal')
@Public()
@UseGuards(ThrottlerGuard)
@Controller('portal/auth')
export class PortalAuthController {
  constructor(private readonly auth: PortalAuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: PortalLoginDto) {
    return this.auth.login(dto);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: PortalRefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Body() dto: PortalRefreshDto) {
    return this.auth.logout(dto.refreshToken);
  }

  /** Always `{ ok: true }` — the answer never reveals whether the account exists. */
  @Post('forgot-password')
  @HttpCode(200)
  forgotPassword(@Body() dto: PortalForgotDto) {
    return this.auth.requestPasswordReset(dto.email, dto.tenant);
  }

  /** Consumes an invitation or reset link; also activates an invited account. */
  @Post('reset-password')
  @HttpCode(200)
  resetPassword(@Body() dto: PortalResetDto) {
    return this.auth.resetPassword(dto.token, dto.password);
  }
}

/**
 * Session-authenticated half of `/portal/auth`. Kept as its own class because
 * `@PortalController()` is a class-level composite: mixing it with the public
 * routes above would put the portal guard on login itself.
 */
@ApiTags('portal')
@PortalController()
@Controller('portal/auth')
export class PortalAuthMeController {
  @Get('me')
  me(@CurrentPortalUser() user: PortalAuthUser): PortalAuthUser {
    // Already a safe projection built by PortalGuard (no hash, no internals).
    return user;
  }
}
