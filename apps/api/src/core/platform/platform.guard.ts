import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Platform-plane guard. On top of the platform-jwt strategy, the PlatformUser
 * status is re-read from the database on EVERY request: platform tokens live
 * 12 h without refresh, so a DISABLED operator must lose access immediately.
 * Platform routes are low-traffic; the per-request DB hit is negligible.
 */
@Injectable()
export class PlatformGuard extends AuthGuard('platform-jwt') {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ok = (await super.canActivate(context)) as boolean;
    if (!ok) return false;
    const request = context.switchToHttp().getRequest();
    const platformUser = await this.prisma.platformUser.findUnique({
      where: { id: request.user.id },
    });
    if (!platformUser || platformUser.status !== 'ACTIVE') {
      throw new UnauthorizedException('Platform account is disabled');
    }
    request.user = {
      id: platformUser.id,
      email: platformUser.email,
      firstName: platformUser.firstName,
      lastName: platformUser.lastName,
    };
    return true;
  }
}
