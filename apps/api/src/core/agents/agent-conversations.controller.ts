import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthUser } from '@pulsar/shared';
import {
  PERMISSIONS,
  type AgentTurnResult,
  failedAgentTurn,
  parseAgentTurnResult,
  agentTurnMessage,
} from '@pulsar/shared';
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
    return this.conversations.get(user.tenantId, user.id, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_CHAT)
  async start(@CurrentUser() user: AuthUser, @Body() dto: StartDto) {
    const agent = await this.agents.getOwned(user.tenantId, dto.agentId);
    const sessionId = await this.runtime.openSession({
      tenantId: user.tenantId,
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
    let assistantSaved = false;
    let outcome: AgentTurnResult | undefined;
    let hadError = false;
    let resultCount = 0;
    try {
      // Ensure a live Hermes session. The in-memory session dies on runtime
      // restart (or was never opened) — transparently resume the persisted
      // conversation so the user can keep chatting instead of hitting an error.
      let sessionId: string | null = conv.hermesSessionId;
      if (!this.runtime.isLive(sessionId)) {
        const agent = await this.agents.getOwned(user.tenantId, conv.agentId);
        sessionId = await this.runtime.resumeSession({
          tenantId: user.tenantId,
          agent: { id: agent.id, model: agent.model, persona: agent.persona },
          pulsarMcpUrl: PULSAR_MCP_URL,
          existingSessionId: conv.hermesSessionId,
        });
        if (sessionId !== conv.hermesSessionId) {
          await this.conversations.updateHermesSession(user.tenantId, conv.id, sessionId);
        }
      }
      if (!sessionId) {
        throw new Error('Conversation has no live session');
      }
      for await (const ev of this.runtime.sendTurn(sessionId, dto.text)) {
        if (ev.type === 'text') {
          assistantText += ev.text;
          send('text', { text: ev.text });
        } else if (ev.type === 'tool_call') {
          send('tool_call', { name: ev.name, args: ev.args });
        } else if (ev.type === 'error') {
          hadError = true;
        } else if (ev.type === 'result') {
          outcome = parseAgentTurnResult(ev.result);
          resultCount++;
        }
      }
      if (!outcome || resultCount !== 1 || (hadError && outcome.status === 'succeeded'))
        outcome = failedAgentTurn();
      const content =
        outcome.status === 'succeeded'
          ? assistantText
          : `[Réponse non validée] ${agentTurnMessage(outcome)}${assistantText ? `\n\nRéponse partielle :\n${assistantText}` : ''}`;
      if (content) await this.conversations.addMessage(conv.id, 'assistant', content);
      assistantSaved = true;
      if (outcome.status === 'failed') send('error', { message: agentTurnMessage(outcome) });
      send('result', { result: outcome });
      send('end', {});
    } catch (e) {
      console.error('[agent-conversations] turn failed:', e instanceof Error ? e.message : e);
      const result = failedAgentTurn('RUNTIME_FAILURE');
      if (!assistantSaved) {
        const content = `[Réponse non validée] ${agentTurnMessage(result)}${assistantText ? `\n\nRéponse partielle :\n${assistantText}` : ''}`;
        try {
          await this.conversations.addMessage(conv.id, 'assistant', content);
        } catch {
          /* DB may itself be unavailable */
        }
      }
      send('error', { message: agentTurnMessage(result) });
      send('result', { result });
      send('end', {});
    } finally {
      res.end();
    }
  }
}
