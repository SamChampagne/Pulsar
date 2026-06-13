import type { AuthUser, PermissionKey } from '@pulsar/shared';

/** Caps stored on Agent.caps (all optional). */
export interface AgentCaps {
  maxAmountPerAction?: number;
  maxActionsPerMinute?: number;
  toolAllowlist?: string[];
  autoApprove?: string[];
}

/**
 * Resolved agent identity used by the MCP layer. `user` is the AuthUser of the
 * agent's hidden service account (for tenant isolation + FK/audit attribution).
 */
export interface AgentPrincipal {
  agentId: string;
  name: string;
  caps: AgentCaps;
  user: AuthUser; // id = service user id, permissions = agent.permissions
}

export const isAgentPermission = (p: string): p is PermissionKey => typeof p === 'string';
