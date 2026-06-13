import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthUser } from '@pulsar/shared';
import { PERMISSIONS } from '@pulsar/shared';
import { IsString } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AgentsService } from './agents.service';
import { AgentRuntimeService } from './agent-runtime.service';
import { AgentConversationsService } from './agent-conversations.service';

class StartDto {
  @IsString() agentId!: string;
}

class TurnDto {
  @IsString() text!: string;
}

const PULSAR_MCP_URL = process.env.PULSAR_MCP_URL ?? 'http://localhost:3000/api/v1/mcp';

@ApiTags('core/agent-conversations')
@ApiBearerAuth()
@Controller('agent-conversations')
export class AgentConversationsController {
  constructor(
    private readonly agents: AgentsService,
    private readonly runtime: AgentRuntimeService,
    private readonly conversations: AgentConversationsService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_CHAT)
  list(@CurrentUser() user: AuthUser) {
    return this.conversations.list(user.tenantId, user.id);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_CHAT)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.conversations.get(user.tenantId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_CHAT)
  async start(@CurrentUser() user: AuthUser, @Body() dto: StartDto) {
    const agent = await this.agents.getOwned(user.tenantId, dto.agentId);
    const sessionId = await this.runtime.openSession({
      agent: { id: agent.id, model: agent.model, persona: agent.persona },
      pulsarMcpUrl: PULSAR_MCP_URL,
    });
    return this.conversations.start(user.tenantId, user.id, dto.agentId, sessionId);
  }

  @Post(':id/messages')
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_CHAT)
  async turn(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: TurnDto,
    @Res() res: Response,
  ) {
    const conv = await this.conversations.assertOwned(user.tenantId, user.id, id);
    await this.conversations.addMessage(conv.id, 'user', dto.text);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    const send = (event: string, data: unknown) =>
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    let assistantText = '';
    try {
      if (!conv.hermesSessionId) {
        send('error', { message: 'Conversation has no live session' });
        return;
      }
      for await (const ev of this.runtime.sendTurn(conv.hermesSessionId, dto.text)) {
        if (ev.type === 'text') {
          assistantText += ev.text;
          send('text', { text: ev.text });
        } else if (ev.type === 'tool_call') {
          send('tool_call', { name: ev.name, args: ev.args });
        } else if (ev.type === 'error') {
          send('error', { message: ev.message });
        } else if (ev.type === 'end') {
          send('end', {});
        }
      }
      if (assistantText) await this.conversations.addMessage(conv.id, 'assistant', assistantText);
    } catch {
      send('error', { message: 'Agent runtime error' });
    } finally {
      res.end();
    }
  }
}
