import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthUser } from '@pulsar/shared';
import { PLATFORM_ADMIN_KEY } from '../decorators/platform-admin.decorator';

/**
 * Gates the cross-tenant platform plane. Only endpoints marked with
 * `@PlatformAdmin()` are restricted; everything else passes through untouched.
 * Runs after JwtAuthGuard (so `request.user` is populated). The flag is carried
 * in the JWT, so revoking platform access takes effect at the next token refresh
 * (same trade-off as permissions — see CLAUDE.md).
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<boolean>(PLATFORM_ADMIN_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const user: AuthUser | undefined = context.switchToHttp().getRequest().user;
    if (!user?.isPlatformAdmin) {
      throw new ForbiddenException('Platform administration access required');
    }
    return true;
  }
}
