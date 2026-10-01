import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Res,
} from '@nestjs/common';
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
import { IsString, MaxLength, Matches } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AgentsService } from './agents.service';
import { AgentRuntimeService } from './agent-runtime.service';
import { AgentConversationsService } from './agent-conversations.service';

class StartDto {
  @IsString() agentId!: string;
}

class TurnDto {
  @IsString() @MaxLength(32000) @Matches(/\S/) text!: string;
}

const PULSAR_MCP_URL = process.env.PULSAR_MCP_URL ?? 'http://localhost:3000/api/v1/mcp';

@ApiTags('core/agent-conversations')
@ApiBearerAuth()
@Controller('agent-conversations')
export class AgentConversationsController {
  // Chat streams are owned by this API instance. No parallel prompt on the same
  // history; independent conversations can progress concurrently.
  private readonly activeTurns = new Set<string>();
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

  @Get('workers')
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_CHAT)
  workers(@CurrentUser() user: AuthUser) {
    return this.conversations.workers(user.tenantId);
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
    if (agent.status !== 'ACTIVE')
      throw new ForbiddenException('Ce worker est en pause ou révoqué.');
    const sessionId = await this.runtime.openSession({
      tenantId: user.tenantId,
      agent: { id: agent.id, model: agent.model, persona: agent.persona },
      pulsarMcpUrl: PULSAR_MCP_URL,
    });
    try {
      return await this.conversations.start(user.tenantId, user.id, dto.agentId, sessionId);
    } catch (error) {
      this.runtime.closeSession(sessionId);
      throw error;
    }
  }

  @Post(':id/messages')
  @RequirePermissions(PERMISSIONS.CORE.AGENTS_CHAT)
  async turn(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: TurnDto,
    @Res() res: Response,
  ) {
    const key = `${user.tenantId}:${user.id}:${id}`;
    if (this.activeTurns.has(key))
      throw new ConflictException('Une réponse est déjà en cours dans cette conversation.');
    this.activeTurns.add(key);
    try {
      return await this.streamTurn(user, id, dto, res);
    } finally {
      this.activeTurns.delete(key);
    }
  }

  private async streamTurn(user: AuthUser, id: string, dto: TurnDto, res: Response) {
    const conv = await this.conversations.assertOwned(user.tenantId, user.id, id);
    const agent = await this.agents.getOwned(user.tenantId, conv.agentId);
    if (agent.status !== 'ACTIVE')
      throw new ForbiddenException('Ce worker est en pause ou révoqué.');
    await this.conversations.addMessage(conv.id, 'user', dto.text);
    await this.conversations.titleFromMessage(user.tenantId, user.id, conv.id, dto.text);

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
    let liveSessionId = conv.hermesSessionId;
    let disconnected = res.destroyed === true;
    const disconnect = () => {
      disconnected = true;
      if (liveSessionId) this.runtime.closeSession(liveSessionId);
    };
    res.once?.('close', disconnect);
    try {
      // Ensure a live Hermes session. The in-memory session dies on runtime
      // restart (or was never opened) — transparently resume the persisted
      // conversation so the user can keep chatting instead of hitting an error.
      let sessionId: string | null = conv.hermesSessionId;
      if (!this.runtime.isLive(sessionId)) {
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
      liveSessionId = sessionId;
      if (disconnected) {
        this.runtime.closeSession(sessionId);
        throw new Error('Client disconnected before prompt');
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
      res.off?.('close', disconnect);
      res.end();
    }
  }
}
