import { BadRequestException, Body, Controller, Get, Post, Put, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthUser } from '@pulsar/shared';
import { PERMISSIONS, RUNTIME_PROVIDERS, getRuntimeProvider } from '@pulsar/shared';
import { IsOptional, IsString } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { RuntimeConfigService } from './runtime-config.service';
import { AgentRuntimeService } from './agent-runtime.service';
import { isInstalled } from './runtime-install';

class UpsertRuntimeDto {
  @IsString() provider!: string;
  @IsOptional() @IsString() apiKey?: string;
  @IsOptional() @IsString() defaultModel?: string;
  @IsOptional() @IsString() baseUrl?: string;
}

@ApiTags('core/agent-runtime')
@ApiBearerAuth()
@Controller('agent-runtime')
export class RuntimeConfigController {
  constructor(
    private readonly runtimeConfig: RuntimeConfigService,
    private readonly runtime: AgentRuntimeService,
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
    const config = await this.runtimeConfig.upsert(user.tenantId, {
      provider: provider.id,
      authMode: provider.authMode,
      apiKey: dto.apiKey,
      defaultModel: dto.defaultModel ?? null,
      baseUrl: dto.baseUrl ?? null,
    });
    return this.runtimeConfig.project(config);
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
    } catch {
      send('error', { message: 'Agent runtime login error' });
    } finally {
      res.end();
    }
  }
}
