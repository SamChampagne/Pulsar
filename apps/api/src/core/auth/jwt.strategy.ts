import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { AuthUser, JwtPayload } from '@pulsar/shared';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  /**
   * Permissions are embedded in the token for now (no DB hit per request).
   * Trade-off: a permission change takes effect at next login / token refresh.
   * Revisit when refresh tokens land (see ROADMAP phase 2).
   */
  validate(payload: JwtPayload & { platformAdmin?: boolean; portal?: unknown }): AuthUser {
    // Watertight separation of the three planes: a platform-plane or
    // customer-portal-plane token must never reach a tenant route (and tenant
    // guards all assume tenantId). A portal token DOES carry a tenantId, so the
    // `portal` claim has to be rejected explicitly — any truthy value, since
    // only tokens we mint are legitimate and they always set `portal: true`.
    if (payload.platformAdmin || payload.portal || !payload.tenantId) {
      throw new UnauthorizedException('Not a tenant access token');
    }
    return {
      id: payload.sub,
      tenantId: payload.tenantId,
      email: payload.email,
      firstName: '',
      lastName: '',
      permissions: payload.permissions ?? [],
    };
  }
}
