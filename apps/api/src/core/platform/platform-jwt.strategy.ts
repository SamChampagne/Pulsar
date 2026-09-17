import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { PlatformJwtPayload } from '@pulsar/shared';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class PlatformJwtStrategy extends PassportStrategy(Strategy, 'platform-jwt') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  validate(
    payload: PlatformJwtPayload & { platformAdmin?: boolean; scope?: string; portal?: unknown },
  ) {
    // Step tokens (mfa-pending / mfa-enroll) carry a scope property and must never
    // be accepted as platform access tokens.
    if ('scope' in payload && payload.scope !== undefined) {
      throw new UnauthorizedException('Step tokens are not valid platform access tokens');
    }
    // Customer-portal tokens are signed with the same secret; they must never
    // be accepted here, even if they somehow also carried a platformAdmin claim.
    if (payload.portal) {
      throw new UnauthorizedException('Not a platform access token');
    }
    if (payload.platformAdmin !== true) {
      throw new UnauthorizedException('Not a platform access token');
    }
    return { id: payload.sub, email: payload.email };
  }
}
