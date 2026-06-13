import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { isExecutableLive } from '@pulsar/shared';
import type { AgentPrincipal } from './agent-principal';
import type { ProposedActionsService } from './proposed-actions.service';
import { TOOL_REGISTRY, type ToolServices } from './tool-registry';

/**
 * Build a fresh stateless McpServer exposing ONLY the tools this agent may use
 * (permission ∩ enabled modules ∩ optional caps.toolAllowlist). READ/LOW run live;
 * MUTATING/SENSITIVE enqueue a proposal.
 */
export function buildAgentMcpServer(
  principal: AgentPrincipal,
  enabledModules: Set<string>,
  proposals: ProposedActionsService,
  services: ToolServices,
): McpServer {
  const server = new McpServer({ name: 'pulsar', version: '1.0.0' });
  const allowlist = principal.caps.toolAllowlist;
  const granted = new Set(principal.user.permissions as string[]);

  for (const def of TOOL_REGISTRY) {
    if (!granted.has(def.permission)) continue;
    if (!enabledModules.has(def.module)) continue;
    if (allowlist && !allowlist.includes(def.name)) continue;

    server.registerTool(
      def.name,
      { title: def.name, description: def.description, inputSchema: def.inputSchema.shape },
      async (args: Record<string, unknown>) => {
        if (isExecutableLive(def.tier)) {
          const result = await def.run(args, { principal, services });
          return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        }
        const auto = principal.caps.autoApprove?.includes(def.name);
        if (auto) {
          const result = await def.run(args, { principal, services });
          return {
            content: [
              { type: 'text' as const, text: JSON.stringify({ autoApproved: true, result }) },
            ],
          };
        }
        const proposal = await proposals.enqueue(principal, def.name, args, {
          triggeredByRef: undefined,
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                queued: true,
                proposalId: proposal.id,
                status: proposal.status,
              }),
            },
          ],
        };
      },
    );
  }
  return server;
}
