import { describe, it, expect } from 'vitest';
import { RiskTier } from './risk';
import { AgentAutonomy } from './autonomy';
import { evaluatePolicy, presetPolicies, effectivePolicies, type PolicyRule } from './policy';

const base = { recentExecutions: 0, maxPerMinute: undefined, maxAmountPerAction: undefined, breakerTripped: false };

describe('evaluatePolicy', () => {
  it('most-specific rule wins: tool rule over tier rule over catch-all', () => {
    const rules: PolicyRule[] = [
      { effect: 'PROPOSE' },
      { tierMax: RiskTier.SENSITIVE, effect: 'PROPOSE' },
      { tool: 'create_load', effect: 'AUTO' },
    ];
    expect(evaluatePolicy(rules, { ...base, tool: 'create_load', tier: RiskTier.MUTATING }).effect).toBe('AUTO');
    expect(evaluatePolicy(rules, { ...base, tool: 'tender_load', tier: RiskTier.SENSITIVE }).effect).toBe('PROPOSE');
  });

  it('defaults to PROPOSE when no rule matches', () => {
    expect(evaluatePolicy([{ tool: 'x', effect: 'AUTO' }], { ...base, tool: 'y', tier: RiskTier.MUTATING }).effect).toBe('PROPOSE');
  });

  it('AUTO downgrades to PROPOSE above the rule maxAmount', () => {
    const rules: PolicyRule[] = [{ tool: 'tender_load', maxAmount: 1000, effect: 'AUTO' }];
    expect(evaluatePolicy(rules, { ...base, tool: 'tender_load', tier: RiskTier.SENSITIVE, amount: 500 }).effect).toBe('AUTO');
    expect(evaluatePolicy(rules, { ...base, tool: 'tender_load', tier: RiskTier.SENSITIVE, amount: 1500 }).effect).toBe('PROPOSE');
  });

  it('DENY above the hard global cap (autonomy never lifts caps)', () => {
    const rules: PolicyRule[] = [{ effect: 'AUTO' }];
    expect(evaluatePolicy(rules, { ...base, tool: 't', tier: RiskTier.MUTATING, amount: 5000, maxAmountPerAction: 1000 }).effect).toBe('DENY');
  });

  it('AUTO downgrades to PROPOSE when the rate cap is reached', () => {
    const rules: PolicyRule[] = [{ effect: 'AUTO' }];
    expect(evaluatePolicy(rules, { ...base, tool: 't', tier: RiskTier.MUTATING, recentExecutions: 5, maxPerMinute: 5 }).effect).toBe('PROPOSE');
  });

  it('breaker forces PROPOSE even when the rule says AUTO', () => {
    expect(evaluatePolicy([{ effect: 'AUTO' }], { ...base, tool: 't', tier: RiskTier.MUTATING, breakerTripped: true }).effect).toBe('PROPOSE');
  });
});

describe('presetPolicies / effectivePolicies', () => {
  it('PROPOSE level → everything proposes', () => {
    expect(presetPolicies(AgentAutonomy.PROPOSE)).toEqual([{ effect: 'PROPOSE' }]);
  });
  it('ACT_LOW → MUTATING auto, SENSITIVE proposes', () => {
    const r = presetPolicies(AgentAutonomy.ACT_LOW);
    expect(evaluatePolicy(r, { ...base, tool: 'a', tier: RiskTier.MUTATING }).effect).toBe('AUTO');
    expect(evaluatePolicy(r, { ...base, tool: 'b', tier: RiskTier.SENSITIVE }).effect).toBe('PROPOSE');
  });
  it('AUTONOMOUS → MUTATING + SENSITIVE auto', () => {
    const r = presetPolicies(AgentAutonomy.AUTONOMOUS);
    expect(evaluatePolicy(r, { ...base, tool: 'b', tier: RiskTier.SENSITIVE }).effect).toBe('AUTO');
  });
  it('effectivePolicies uses caps.policies when present, else preset + legacy autoApprove', () => {
    const explicit: PolicyRule[] = [{ tool: 'x', effect: 'DENY' }];
    expect(effectivePolicies(explicit, AgentAutonomy.PROPOSE, [])).toBe(explicit);
    const fallback = effectivePolicies(undefined, AgentAutonomy.PROPOSE, ['create_load']);
    expect(evaluatePolicy(fallback, { ...base, tool: 'create_load', tier: RiskTier.MUTATING }).effect).toBe('AUTO');
  });
});
