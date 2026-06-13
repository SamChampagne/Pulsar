import { createHash } from 'node:crypto';

/** How a tool call is governed — independent of the RBAC permission it requires. */
export enum RiskTier {
  READ = 'READ',
  LOW = 'LOW',
  MUTATING = 'MUTATING',
  SENSITIVE = 'SENSITIVE',
}

export enum AgentStatus {
  ACTIVE = 'ACTIVE',
  REVOKED = 'REVOKED',
}

export enum ProposalStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  EXECUTED = 'EXECUTED',
  FAILED = 'FAILED',
}

/** READ/LOW run immediately in the MCP handler; MUTATING/SENSITIVE go to the queue. */
export function isExecutableLive(tier: RiskTier): boolean {
  return tier === RiskTier.READ || tier === RiskTier.LOW;
}

export interface CapResult {
  ok: boolean;
  reason?: string;
}

/** Monetary ceiling per action. Unknown amount or unset cap => pass. */
export function evaluateAmountCap(amount: number | undefined, maxAmount: number | undefined): CapResult {
  if (amount === undefined || maxAmount === undefined) return { ok: true };
  if (amount > maxAmount) {
    return { ok: false, reason: `Amount ${amount} exceeds the agent cap of ${maxAmount}.` };
  }
  return { ok: true };
}

/** Throughput ceiling. `recentCount` = proposals in the trailing minute. Unset limit => pass. */
export function evaluateRateCap(recentCount: number, maxPerMinute: number | undefined): CapResult {
  if (maxPerMinute === undefined) return { ok: true };
  if (recentCount >= maxPerMinute) {
    return { ok: false, reason: `Rate limit of ${maxPerMinute} actions/minute reached.` };
  }
  return { ok: true };
}

/** Stable hash of tool + canonicalized args — the default idempotency key. */
export function deriveIdempotencyKey(tool: string, args: Record<string, unknown>): string {
  const canonical = JSON.stringify(args, Object.keys(args).sort());
  return createHash('sha256').update(`${tool}:${canonical}`).digest('hex').slice(0, 32);
}
