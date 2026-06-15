import type { AgentAutonomy, AuthUser, PolicyRule } from '@pulsar/shared';

/** Caps stored on Agent.caps (all optional). */
export interface AgentCaps {
  maxAmountPerAction?: number;
  maxActionsPerMinute?: number;
  toolAllowlist?: string[];
  autoApprove?: string[];
  /** phase 12: this agent runs always-on (headless workbench runner wakes it on assigned tasks). */
  alwaysOn?: boolean;
  /** phase 12: operating-task categories this agent auto-handles (e.g. ['DELAY','TENDER_FAILURE']). */
  handlesCategories?: string[];
  /** phase 14: declarative governance rules; when present, override the autonomy dial. */
  policies?: PolicyRule[];
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
  /** When the agent acts on behalf of a specific operating task (headless runner). */
  triggeredByRef?: string;
  /** phase 14: the agent's coarse autonomy dial (drives effectivePolicies fallback). */
  autonomyLevel: AgentAutonomy;
}
