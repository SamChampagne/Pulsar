import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { PortalJwtPayload, PortalUserRole } from '@pulsar/shared';
import { ExtractJwt, Strategy } from 'passport-jwt';

/** Claims carried by a portal access token, as handed to PortalGuard. */
export interface PortalTokenClaims {
  id: string;
  tenantId: string;
  customerId: string;
  email: string;
  role: PortalUserRole;
}

/**
 * Third authentication plane: customer-portal accounts (`PortalUser`).
 * Same `JWT_SECRET` as the tenant and platform planes — the planes are
 * separated by a claim, so this strategy accepts ONLY payloads explicitly
 * marked `portal: true`, and the two other strategies reject `portal`.
 *
 * This only validates the token shape; the account status, its customer and
 * the module activation are re-read from the database on every request by
 * PortalGuard.
 */
@Injectable()
export class PortalJwtStrategy extends PassportStrategy(Strategy, 'portal-jwt') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  validate(payload: PortalJwtPayload & { platformAdmin?: boolean }): PortalTokenClaims {
    // Strict `=== true`: a truthy-looking claim (e.g. the string "true") is not
    // a portal token. A payload claiming both planes is a plane confusion and
    // is refused outright.
    if (payload.portal !== true || payload.platformAdmin) {
      throw new UnauthorizedException('Not a portal access token');
    }
    // Subject and both scopes are required: PortalGuard scopes its lookup by the
    // three of them, and an undefined value would be silently dropped from the
    // Prisma filter — widening `findFirst` to "any portal user".
    if (!payload.sub || !payload.tenantId || !payload.customerId) {
      throw new UnauthorizedException('Not a portal access token');
    }
    return {
      id: payload.sub,
      tenantId: payload.tenantId,
      customerId: payload.customerId,
      email: payload.email,
      role: payload.role,
    };
  }
}
