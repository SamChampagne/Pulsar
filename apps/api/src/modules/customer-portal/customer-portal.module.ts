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
import { PortalAuthController, PortalAuthMeController } from './auth/portal-auth.controller';
import { PortalAuthService } from './auth/portal-auth.service';
import { PortalJwtStrategy } from './auth/portal-jwt.strategy';
import { PortalGuard } from './auth/portal.guard';
import { PortalUsersAdminController } from './portal-users.admin.controller';
import { PortalUsersSelfController } from './portal-users.self.controller';
import { PortalUsersService } from './portal-users.service';

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
  controllers: [
    PortalLinksController,
    PortalPublicController,
    PortalAdminController,
    // ThrottlerModule and EmailModule (MailService) are global; AuditLogsModule
    // is imported above.
    PortalAuthController,
    PortalAuthMeController,
    PortalUsersAdminController,
    PortalUsersSelfController,
  ],
  providers: [PortalService, PortalAuthService, PortalUsersService, PortalJwtStrategy, PortalGuard],
})
export class CustomerPortalModule {}
