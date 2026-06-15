import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, PartialType } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { AgentAutonomy, PERMISSIONS } from '@pulsar/shared';
import { ArrayMinSize, IsArray, IsEnum, IsObject, IsOptional, IsString } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ListQueryDto } from '../../common/dto/list-query.dto';
import { AgentsService } from './agents.service';
import type { AgentCaps } from './agent-principal';

class CreateAgentDto {
  @IsString() name!: string;

  @IsOptional() @IsString() description?: string;

  @IsArray() @ArrayMinSize(1) @IsString({ each: true })
  permissions!: string[];

  @IsOptional() @IsObject()
  caps?: AgentCaps;

  @IsOptional() @IsString() persona?: string;
  @IsOptional() @IsString() role?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsEnum(AgentAutonomy) autonomyLevel?: AgentAutonomy;
  @IsOptional() @IsString() avatar?: string;
}

class UpdateAgentDto extends PartialType(CreateAgentDto) {}

@ApiTags('core/agents')
@ApiBearerAuth()
@Controller('agents')
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  @Post('pause-all')
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_MANAGE)
  pauseAll(@CurrentUser() user: AuthUser) {
    return this.agents.pauseAll(user.tenantId);
  }

  @Get('control-tower')
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_READ)
  controlTower(@CurrentUser() user: AuthUser, @Query('days') days?: string) {
    return this.agents.controlTower(user.tenantId, days ? Number(days) : 30);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_READ)
  list(@CurrentUser() user: AuthUser) {
    return this.agents.list(user.tenantId);
  }

  @Get(':id/activity')
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_READ)
  activity(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.agents.activity(user.tenantId, id);
  }

  @Get(':id/runs')
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_READ)
  runs(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query() q: ListQueryDto) {
    return this.agents.listRuns(user.tenantId, id, q);
  }

  @Get(':id/trust')
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_READ)
  trust(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.agents.trust(user.tenantId, id);
  }

  @Get(':id/kpis')
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_READ)
  kpis(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('days') days?: string) {
    return this.agents.kpis(user.tenantId, id, days ? Number(days) : 30);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_READ)
  getOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.agents.getOne(user.tenantId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAgentDto) {
    return this.agents.create(user.tenantId, user.id, dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateAgentDto) {
    return this.agents.update(user.tenantId, id, dto);
  }

  @Post(':id/pause')
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_MANAGE)
  pause(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.agents.pause(user.tenantId, id);
  }

  @Post(':id/resume')
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_MANAGE)
  resume(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.agents.resume(user.tenantId, id);
  }

  @Post(':id/run-now')
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_MANAGE)
  runNow(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.agents.runNow(user.tenantId, id);
  }

  @Post(':id/reset-breaker')
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_MANAGE)
  resetBreaker(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.agents.resetBreaker(user.tenantId, id);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_MANAGE)
  revoke(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.agents.revoke(user.tenantId, id);
  }
}
