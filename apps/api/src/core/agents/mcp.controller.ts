import { Controller, Post, Get, Delete, Req, Res, Inject } from '@nestjs/common';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { TenantModulesCacheService } from '../../prisma/tenant-modules-cache.service';
import { AgentsService } from './agents.service';
import { ProposedActionsService } from './proposed-actions.service';
import { buildAgentMcpServer } from './mcp-server.factory';
import { AGENT_TOOL_SERVICES, type ToolServices } from './tool-registry';

@Controller('mcp')
export class McpController {
  constructor(
    private readonly agents: AgentsService,
    private readonly proposals: ProposedActionsService,
    private readonly modulesCache: TenantModulesCacheService,
    @Inject(AGENT_TOOL_SERVICES) private readonly toolServices: ToolServices,
  ) {}

  @Post()
  @Public()
  async handle(@Req() req: Request, @Res() res: Response) {
    const rawKey = (req.headers['x-agent-key'] as string) ?? bearer(req.headers['authorization']);
    if (!rawKey) {
      res.status(401).json({ error: 'Missing agent key' });
      return;
    }
    let principal: Awaited<ReturnType<AgentsService['validateKey']>>;
    try {
      principal = await this.agents.validateKey(rawKey);
    } catch {
      res.status(401).json({ error: 'Invalid agent key' });
      return;
    }
    // getEnabledKeys returns a Set<string> of the tenant's enabled module keys
    // (module.key === MODULE_KEYS.* values === def.module used by the factory).
    const enabled = await this.modulesCache.getEnabledKeys(principal.user.tenantId);
    const server = buildAgentMcpServer(principal, enabled, this.proposals, this.toolServices);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) res.status(500).json({ error: 'MCP request failed' });
    }
  }

  // Stateless mode uses POST only.
  @Get()
  @Public()
  getMethod(@Res() res: Response) {
    res.status(405).json({ error: 'Use POST' });
  }

  @Delete()
  @Public()
  delMethod(@Res() res: Response) {
    res.status(405).json({ error: 'Use POST' });
  }
}

function bearer(header?: string): string | undefined {
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return undefined;
}
