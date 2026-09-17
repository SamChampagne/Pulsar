import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CryptoModule } from '../crypto/crypto.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { jwtModuleAsyncOptions } from './jwt.options';
import { JwtStrategy } from './jwt.strategy';
import { OidcController } from './oidc/oidc.controller';
import { OidcService } from './oidc/oidc.service';

@Module({
  imports: [
    PassportModule,
    AuditLogsModule,
    CryptoModule,
    JwtModule.registerAsync(jwtModuleAsyncOptions),
  ],
  controllers: [AuthController, OidcController],
  providers: [AuthService, JwtStrategy, OidcService],
  exports: [AuthService],
})
export class AuthModule {}
