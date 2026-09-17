import { ConfigModule, ConfigService } from '@nestjs/config';
import type { JwtModuleAsyncOptions, JwtModuleOptions, JwtSignOptions } from '@nestjs/jwt';

/**
 * Single JwtModule configuration shared by every authentication plane
 * (tenant `AuthModule`, customer-portal `CustomerPortalModule`): same
 * `JWT_SECRET`, same default lifetime. The planes are separated by a claim
 * (`platformAdmin` / `portal`) checked in each strategy — NOT by the secret —
 * so this config must never drift between modules.
 */
export const jwtModuleAsyncOptions: JwtModuleAsyncOptions = {
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService): JwtModuleOptions => ({
    secret: config.getOrThrow<string>('JWT_SECRET'),
    signOptions: {
      expiresIn: config.get('JWT_EXPIRES_IN', '8h') as JwtSignOptions['expiresIn'],
    },
  }),
};
