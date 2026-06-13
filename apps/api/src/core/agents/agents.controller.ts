import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PartialType } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { AgentAutonomy, PERMISSIONS } from '@pulsar/shared';
import { ArrayMinSize, IsArray, IsEnum, IsObject, IsOptional, IsString } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
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

  @Get()
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_READ)
  list(@CurrentUser() user: AuthUser) {
    return this.agents.list(user.tenantId);
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

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_MANAGE)
  revoke(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.agents.revoke(user.tenantId, id);
  }
}
