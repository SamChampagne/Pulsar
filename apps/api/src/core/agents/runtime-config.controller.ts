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
import { isInstalled } from './runtime-install';
import { RuntimeHealthService } from './runtime-health.service';

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
      installed: isInstalled(),
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
  healthStatus() {
    return this.health.inspect();
  }

  @Post('test')
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_MANAGE)
  test(@CurrentUser() user: AuthUser) {
    return this.runtime.testConnection(user.tenantId);
  }

  @Post('connect')
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_MANAGE)
  async connect(@CurrentUser() user: AuthUser, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    const send = (event: string, data: unknown) =>
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    try {
      for await (const ev of this.runtime.connectLogin(user.tenantId)) {
        if (ev.type === 'text') {
          send('text', { text: ev.text });
        } else if (ev.type === 'error') {
          send('error', { message: ev.message });
        } else if (ev.type === 'end') {
          send('end', {});
        }
      }
    } catch (err) {
      // Surface the real cause instead of a generic message — the login subprocess
      // error (e.g. unsupported provider command, Hermes not installed) is what the
      // operator needs to fix it.
      const detail = err instanceof Error ? err.message : String(err);
      send('error', { message: `Échec du login runtime : ${detail}` });
    } finally {
      res.end();
    }
  }
}
