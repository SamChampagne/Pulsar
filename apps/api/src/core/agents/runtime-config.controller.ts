import { BadRequestException, Body, Controller, Get, Post, Put, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthUser } from '@pulsar/shared';
import { AuditAction, PERMISSIONS, RUNTIME_PROVIDERS, getRuntimeProvider } from '@pulsar/shared';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { RuntimeConfigService } from './runtime-config.service';
import { AgentRuntimeService } from './agent-runtime.service';
import { remoteRuntimeEnabled } from './remote-runtime';
import { RuntimeHealthService } from './runtime-health.service';
import { streamLoginSse } from './login-sse';

class UpsertRuntimeDto {
  @IsString() @IsIn(RUNTIME_PROVIDERS.map((p) => p.id)) provider!: string;
  @IsOptional() @IsString() @MaxLength(512) apiKey?: string;
  @IsOptional() @IsString() @MaxLength(512) @Matches(/^[^\r\n]*$/) defaultModel?: string;
  @IsOptional() @IsString() @MaxLength(512) @Matches(/^[^\r\n]*$/) baseUrl?: string;
}

@ApiTags('core/agent-runtime')
@ApiBearerAuth()
@Controller('agent-runtime')
export class RuntimeConfigController {
  constructor(
    private readonly runtimeConfig: RuntimeConfigService,
    private readonly runtime: AgentRuntimeService,
    private readonly audit: AuditLogsService,
    private readonly health: RuntimeHealthService,
  ) {}

  @Get('providers')
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_MANAGE)
  providers() {
    return RUNTIME_PROVIDERS;
  }

  @Get()
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_MANAGE)
  async get(@CurrentUser() user: AuthUser) {
    return {
      ...this.runtimeConfig.project(await this.runtimeConfig.get(user.tenantId)),
      installed: await this.runtime.installedForTenant(user.tenantId),
      runtimeMode: remoteRuntimeEnabled() ? 'remote' : 'local',
    };
  }

  @Put()
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_MANAGE)
  async upsert(@CurrentUser() user: AuthUser, @Body() dto: UpsertRuntimeDto) {
    const provider = getRuntimeProvider(dto.provider);
    if (!provider) {
      throw new BadRequestException(`Unknown runtime provider "${dto.provider}"`);
    }
    if (dto.baseUrl) {
      let url: URL;
      try {
        url = new URL(dto.baseUrl);
      } catch {
        throw new BadRequestException('URL du fournisseur invalide');
      }
      if (
        remoteRuntimeEnabled() &&
        (url.protocol !== 'https:' || (url.port && url.port !== '443'))
      ) {
        throw new BadRequestException(
          'Le runner de production accepte uniquement HTTPS sur le port 443. Le domaine doit être autorisé par l’administrateur.',
        );
      }
      if (
        !provider.needsBaseUrl ||
        !['https:', 'http:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      ) {
        throw new BadRequestException(
          'Utilisez une URL HTTP(S) sans identifiants, paramètres ni fragment pour un fournisseur compatible.',
        );
      }
    }
    if (provider.authMode === 'login' && dto.apiKey)
      throw new BadRequestException('Ce fournisseur utilise une connexion OAuth, pas une clé API.');
    const config = await this.runtimeConfig.upsert(user.tenantId, {
      provider: provider.id,
      authMode: provider.authMode,
      apiKey: dto.apiKey,
      defaultModel: dto.defaultModel ?? null,
      baseUrl: dto.baseUrl ?? null,
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.id,
      action: AuditAction.UPDATE,
      entityType: 'agent-runtime-config',
      after: { provider: provider.id, authMode: provider.authMode, hasApiKey: !!dto.apiKey },
    });
    return this.runtimeConfig.project(config);
  }

  @Get('readiness')
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_MANAGE)
  readiness(@CurrentUser() user: AuthUser) {
    // Tenant-level readiness (no per-agent model override) — lets the UI show a proactive
    // "can this tenant's agents actually run right now" chip instead of only surfacing the
    // block reason as a toast after a failed "Run now" click. Pure RuntimeReadiness, no secrets.
    return this.runtime.readiness(user.tenantId);
  }

  @Get('health')
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_MANAGE)
  healthStatus(@CurrentUser() user: AuthUser) {
    return this.health.inspect(user.tenantId);
  }

  @Post('test')
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_MANAGE)
  test(@CurrentUser() user: AuthUser) {
    return this.runtime.testConnection(user.tenantId);
  }

  @Post('connect')
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_MANAGE)
  async connect(@CurrentUser() user: AuthUser, @Res() res: Response) {
    return streamLoginSse(res, (signal) => this.runtime.connectLogin(user.tenantId, signal));
  }
}
