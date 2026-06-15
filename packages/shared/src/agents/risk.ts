// NOTE: `node:crypto` is intentionally NOT imported at module scope. This file is
// re-exported from the @pulsar/shared barrel, which the web SPA bundles from source;
// a static `node:crypto` import would break the browser build. `deriveIdempotencyKey`
// (the only consumer) is API-only, so we resolve the module lazily at call time.

// Mirrored in packages/database schema.prisma (Task 3 of the phase 11 plan).
/** How a tool call is governed — independent of the RBAC permission it requires. */
export enum RiskTier {
  READ = 'READ',
  LOW = 'LOW',
  MUTATING = 'MUTATING',
  SENSITIVE = 'SENSITIVE',
}

// Mirrored in packages/database schema.prisma (Task 3 of the phase 11 plan).
export enum AgentStatus {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  REVOKED = 'REVOKED',
}

// Mirrored in packages/database schema.prisma (Task 3 of the phase 11 plan).
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
export function evaluateAmountCap(
  amount: number | undefined,
  maxAmount: number | undefined,
): CapResult {
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

function sortedStringify(val: unknown): string {
  if (val === null || typeof val !== 'object' || Array.isArray(val)) {
    return JSON.stringify(val);
  }
  const obj = val as Record<string, unknown>;
  const sorted = Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${sortedStringify(obj[k])}`);
  return `{${sorted.join(',')}}`;
}

/** Stable hash of tool + canonicalized args — the default idempotency key. */
export function deriveIdempotencyKey(tool: string, args: Record<string, unknown>): string {
  // Lazy require keeps `node:crypto` out of the browser bundle's static import graph.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  return createHash('sha256')
    .update(`${tool}:${sortedStringify(args)}`)
    .digest('hex')
    .slice(0, 32);
}
