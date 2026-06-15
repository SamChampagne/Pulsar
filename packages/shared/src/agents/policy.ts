import { RiskTier } from './risk';
import { AgentAutonomy } from './autonomy';

// Pure, browser-safe. No node:* imports.

export type PolicyEffect = 'AUTO' | 'PROPOSE' | 'DENY';

/** A declarative governance rule. Absent fields = "matches anything". */
export interface PolicyRule {
  tool?: string;
  tierMax?: RiskTier;
  maxAmount?: number;
  effect: PolicyEffect;
}

export interface PolicyContext {
  tool: string;
  tier: RiskTier;
  amount?: number;
  recentExecutions: number;
  maxPerMinute?: number;
  maxAmountPerAction?: number;
  breakerTripped?: boolean;
}

export interface PolicyDecision {
  effect: PolicyEffect;
  reason?: string;
}

const TIER_ORDER: Record<RiskTier, number> = {
  [RiskTier.READ]: 0,
  [RiskTier.LOW]: 1,
  [RiskTier.MUTATING]: 2,
  [RiskTier.SENSITIVE]: 3,
};

/** Higher = more specific. tool > tier > catch-all. */
function specificity(rule: PolicyRule): number {
  if (rule.tool !== undefined) return 2;
  if (rule.tierMax !== undefined) return 1;
  return 0;
}

function matches(rule: PolicyRule, ctx: PolicyContext): boolean {
  if (rule.tool !== undefined && rule.tool !== ctx.tool) return false;
  if (rule.tierMax !== undefined && TIER_ORDER[ctx.tier] > TIER_ORDER[rule.tierMax]) return false;
  return true;
}

/**
 * The single autonomy decision. READ/LOW are handled live upstream (isExecutableLive);
 * this is only called for MUTATING/SENSITIVE. Most-specific matching rule wins; no match
 * defaults to PROPOSE. An AUTO effect is downgraded to PROPOSE by the breaker, the rule's
 * maxAmount, or the rate cap; and DENIED above the hard global amount cap.
 */
export function evaluatePolicy(rules: PolicyRule[], ctx: PolicyContext): PolicyDecision {
  let best: PolicyRule | undefined;
  let bestScore = -1;
  for (const rule of rules) {
    if (!matches(rule, ctx)) continue;
    const s = specificity(rule);
    if (s > bestScore) {
      best = rule;
      bestScore = s;
    }
  }
  const effect = best?.effect ?? 'PROPOSE';
  if (effect !== 'AUTO') return { effect };

  // Hard global cap is absolute — autonomy never lifts it (rule 23).
  if (ctx.amount !== undefined && ctx.maxAmountPerAction !== undefined && ctx.amount > ctx.maxAmountPerAction) {
    return { effect: 'DENY', reason: `Amount ${ctx.amount} exceeds the hard cap ${ctx.maxAmountPerAction}.` };
  }
  if (ctx.breakerTripped) return { effect: 'PROPOSE', reason: 'Circuit breaker active.' };
  if (best?.maxAmount !== undefined && ctx.amount !== undefined && ctx.amount > best.maxAmount) {
    return { effect: 'PROPOSE', reason: `Amount ${ctx.amount} exceeds rule cap ${best.maxAmount}.` };
  }
  if (ctx.maxPerMinute !== undefined && ctx.recentExecutions >= ctx.maxPerMinute) {
    return { effect: 'PROPOSE', reason: `Rate limit ${ctx.maxPerMinute}/min reached.` };
  }
  return { effect: 'AUTO' };
}

/** Tier-based rules for the coarse autonomy dial. */
export function presetPolicies(level: AgentAutonomy): PolicyRule[] {
  switch (level) {
    case AgentAutonomy.PROPOSE:
      return [{ effect: 'PROPOSE' }];
    case AgentAutonomy.ACT_LOW:
      return [{ tierMax: RiskTier.MUTATING, effect: 'AUTO' }, { tierMax: RiskTier.SENSITIVE, effect: 'PROPOSE' }];
    case AgentAutonomy.AUTONOMOUS:
      return [{ tierMax: RiskTier.SENSITIVE, effect: 'AUTO' }];
  }
}

/**
 * Resolve the rules to evaluate for an agent. Explicit `caps.policies` win; otherwise the
 * dial preset plus any legacy `caps.autoApprove` tool names as tool-specific AUTO rules
 * (so existing agents' explicit grants are preserved and new tools are covered by the tier preset).
 */
export function effectivePolicies(
  policies: PolicyRule[] | undefined,
  level: AgentAutonomy,
  autoApprove: string[] | undefined,
): PolicyRule[] {
  if (policies && policies.length > 0) return policies;
  const legacy: PolicyRule[] = (autoApprove ?? []).map((tool) => ({ tool, effect: 'AUTO' as const }));
  return [...presetPolicies(level), ...legacy];
}
