import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { isExecutableLive } from '@pulsar/shared';
import type { AgentPrincipal } from './agent-principal';
import type { ProposedActionsService } from './proposed-actions.service';
import { TOOL_REGISTRY, type ToolServices } from './tool-registry';
import { toolRequiredModules, toolRequiredPermissions } from './tool-types';

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
    // Authorization is carried by the registry and enforced BEFORE exposure: an
    // agent must hold EVERY required permission and the tenant must have EVERY
    // required module enabled. A cross-module tool (e.g. the CRM→TMS bridge) is
    // never partially authorized — missing crm.read OR a disabled module hides it.
    if (!toolRequiredPermissions(def).every((p) => granted.has(p))) continue;
    if (!toolRequiredModules(def).every((m) => enabledModules.has(m))) continue;
    if (allowlist && !allowlist.includes(def.name)) continue;

    server.registerTool(
      def.name,
      { title: def.name, description: def.description, inputSchema: def.inputSchema.shape },
      async (args: Record<string, unknown>) => {
        if (isExecutableLive(def.tier)) {
          const result = await def.run(args, { principal, services });
          return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        }
        const decision = await proposals.handleMutatingTool(principal, def, args, services);
        if (decision.effect === 'DENY') {
          return {
            content: [{ type: 'text' as const, text: decision.reason ?? 'Denied by policy' }],
            isError: true,
          };
        }
        if (decision.effect === 'PROPOSE') {
          return {
            content: [
              { type: 'text' as const, text: JSON.stringify({ queued: true, proposalId: decision.proposalId, status: 'PENDING' }) },
            ],
          };
        }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ autoApproved: true, result: decision.result }) }],
        };
      },
    );
  }
  return server;
}
