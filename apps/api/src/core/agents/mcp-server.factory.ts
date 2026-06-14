import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { evaluateAmountCap, isExecutableLive } from '@pulsar/shared';
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
          // Auto-approve skips ProposedActionsService.enqueue, so the amount cap
          // MUST be enforced here too — otherwise an AUTONOMOUS agent could run a
          // tool above its maxAmountPerAction unchecked (governance hole).
          // NOTE (TODO): the RATE cap is NOT enforced on this path — auto-approved
          // actions don't create proposals, so there's no trailing-minute count to
          // evaluate. Closing that gap needs a separate execution-count source.
          const amount = def.amountFrom?.(args);
          const cap = evaluateAmountCap(amount, principal.caps.maxAmountPerAction);
          if (!cap.ok) {
            return {
              content: [{ type: 'text' as const, text: cap.reason ?? 'Amount cap exceeded' }],
              isError: true,
            };
          }
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
