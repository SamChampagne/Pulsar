import { describe, it, expect } from 'vitest';
import { AgentAutonomy, autoApprovedTiers } from './autonomy';
import { RiskTier } from './risk';

describe('autoApprovedTiers', () => {
  it('PROPOSE auto-approves nothing', () => {
    expect(autoApprovedTiers(AgentAutonomy.PROPOSE)).toEqual([]);
  });
  it('ACT_LOW auto-approves MUTATING only', () => {
    expect(autoApprovedTiers(AgentAutonomy.ACT_LOW)).toEqual([RiskTier.MUTATING]);
  });
  it('AUTONOMOUS auto-approves MUTATING and SENSITIVE', () => {
    expect(autoApprovedTiers(AgentAutonomy.AUTONOMOUS)).toEqual([
      RiskTier.MUTATING,
      RiskTier.SENSITIVE,
    ]);
  });
  it('never auto-approves READ/LOW explicitly (they run live anyway)', () => {
    for (const lvl of [AgentAutonomy.PROPOSE, AgentAutonomy.ACT_LOW, AgentAutonomy.AUTONOMOUS]) {
      expect(autoApprovedTiers(lvl)).not.toContain(RiskTier.READ);
      expect(autoApprovedTiers(lvl)).not.toContain(RiskTier.LOW);
    }
  });
});
