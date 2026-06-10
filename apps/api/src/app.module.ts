import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { EmailModule } from './core/email/email.module';
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
import { TransportationModule } from './modules/transportation/transportation.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Local dev reads the root .env; deployed environments inject real env vars.
      envFilePath: ['.env', '../../.env'],
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    EmailModule,
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
    // Business modules (activable per tenant — see ModulesGuard)
    TransportationModule,
  ],
  providers: [
    // Guard order matters: authenticate, then check module activation, then permissions.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ModulesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
