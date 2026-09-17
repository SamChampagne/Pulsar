import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuditLogsModule } from '../../core/audit-logs/audit-logs.module';
import { jwtModuleAsyncOptions } from '../../core/auth/jwt.options';
import { DocumentsModule } from '../../core/documents/documents.module';
import { BillingModule } from '../billing/billing.module';
import { OperatingModule } from '../../core/operating/operating.module';
import {
  PortalAdminController,
  PortalLinksController,
  PortalPublicController,
} from './portal.controller';
import { PortalService } from './portal.service';
import { PortalJwtStrategy } from './auth/portal-jwt.strategy';
import { PortalGuard } from './auth/portal.guard';

@Module({
  imports: [
    PassportModule,
    // Same secret and lifetime as the tenant plane: the planes are separated by
    // a token claim, not by the signing key (see core/auth/jwt.options.ts).
    JwtModule.registerAsync(jwtModuleAsyncOptions),
    AuditLogsModule,
    DocumentsModule,
    BillingModule,
    OperatingModule,
  ],
  controllers: [PortalLinksController, PortalPublicController, PortalAdminController],
  providers: [PortalService, PortalJwtStrategy, PortalGuard],
})
export class CustomerPortalModule {}
