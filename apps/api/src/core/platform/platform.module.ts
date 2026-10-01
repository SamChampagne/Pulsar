import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CryptoModule } from '../crypto/crypto.module';
import { EmailModule } from '../email/email.module';
import { PlatformAuthController } from './platform-auth.controller';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformJwtStrategy } from './platform-jwt.strategy';
import { PlatformGuard } from './platform.guard';
import { PlatformMfaController } from './platform-mfa.controller';
import { PlatformMfaService } from './platform-mfa.service';
import { PlatformTenantsController } from './platform-tenants.controller';
import { PlatformTenantsService } from './platform-tenants.service';
import { ApsModule } from '../aps/aps.module';
import { PlatformOperationsController } from './platform-operations.controller';
import { PlatformOperationsService } from './platform-operations.service';
import { DeploymentObservationService } from './deployment-observation.service';
import { PlatformServicesController } from './platform-services.controller';
import { PlatformServicesService } from './platform-services.service';
import { RuntimeConfigService } from '../agents/runtime-config.service';
import { RuntimeHealthService } from '../agents/runtime-health.service';

@Module({
  imports: [
    ApsModule,
    AuditLogsModule,
    CryptoModule,
    EmailModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService): JwtModuleOptions => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [
    PlatformServicesController,
    PlatformAuthController,
    PlatformMfaController,
    PlatformTenantsController,
    PlatformOperationsController,
  ],
  providers: [
    PlatformServicesService,
    RuntimeConfigService,
    RuntimeHealthService,
    DeploymentObservationService,
    PlatformOperationsService,
    PlatformAuthService,
    PlatformJwtStrategy,
    PlatformGuard,
    PlatformMfaService,
    PlatformTenantsService,
  ],
})
export class PlatformModule {}
