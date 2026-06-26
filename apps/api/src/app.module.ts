import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { ApiKeysModule } from './core/api-keys/api-keys.module';
import { AgentsModule } from './core/agents/agents.module';
import { ApsModule } from './core/aps/aps.module';
import { EmailModule } from './core/email/email.module';
import { RoutingModule } from './core/routing/routing.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { ModulesGuard } from './common/guards/modules.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { AuthModule } from './core/auth/auth.module';
import { TenantsModule } from './core/tenants/tenants.module';
import { UsersModule } from './core/users/users.module';
import { RolesModule } from './core/roles/roles.module';
import { PermissionsModule } from './core/permissions/permissions.module';
import { AuditLogsModule } from './core/audit-logs/audit-logs.module';
import { DocumentsModule } from './core/documents/documents.module';
import { NotificationsModule } from './core/notifications/notifications.module';
import { IntegrationsModule } from './core/integrations/integrations.module';
import { ModuleRegistryModule } from './core/module-registry/module-registry.module';
import { OnboardingModule } from './core/onboarding/onboarding.module';
import { PlatformModule } from './core/platform/platform.module';
import { TransportationModule } from './modules/transportation/transportation.module';
import { FleetModule } from './modules/fleet/fleet.module';
import { WmsModule } from './modules/wms/wms.module';
import { YardModule } from './modules/yard/yard.module';
import { CustomerPortalModule } from './modules/customer-portal/customer-portal.module';
import { CarrierPortalModule } from './modules/carrier-portal/carrier-portal.module';
import { BillingModule } from './modules/billing/billing.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { ProcurementModule } from './modules/procurement/procurement.module';
import { CrmModule } from './modules/crm/crm.module';
import { ManufacturingModule } from './modules/manufacturing/manufacturing.module';
import { OperatingModule } from './core/operating/operating.module';
import { AutomationModule } from './core/automation/automation.module';
import { PreferencesModule } from './core/preferences/preferences.module';
import { ConnectModule } from './core/connect/connect.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Local dev reads the root .env; deployed environments inject real env vars.
      envFilePath: ['.env', '../../.env'],
    }),
    ScheduleModule.forRoot(),
    // ThrottlerModule is registered here (app root) so its storage and config
    // providers are available application-wide via DI. The ThrottlerGuard is NOT
    // added as APP_GUARD — it is applied selectively on PlatformAuthController only.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 20 }]),
    PrismaModule,
    EmailModule,
    RoutingModule,
    ApiKeysModule,
    AgentsModule,
    ApsModule,
    // Core platform modules
    AuthModule,
    TenantsModule,
    UsersModule,
    RolesModule,
    PermissionsModule,
    AuditLogsModule,
    DocumentsModule,
    NotificationsModule,
    IntegrationsModule,
    ModuleRegistryModule,
    OnboardingModule,
    PlatformModule,
    OperatingModule,
    AutomationModule,
    PreferencesModule,
    ConnectModule,
    // Business modules (activable per tenant — see ModulesGuard)
    TransportationModule,
    FleetModule,
    WmsModule,
    YardModule,
    CustomerPortalModule,
    CarrierPortalModule,
    BillingModule,
    AnalyticsModule,
    ProcurementModule,
    CrmModule,
    ManufacturingModule,
  ],
  providers: [
    // Guard order matters: authenticate, then check module activation, then permissions.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ModulesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
