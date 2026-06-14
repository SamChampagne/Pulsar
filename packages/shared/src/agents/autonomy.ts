import { RiskTier } from './risk';

// Mirrored in packages/database schema.prisma (Task 4 of the palier 2a plan).
/** Coarse autonomy dial for an employee-agent. Maps to which risk tiers auto-approve. */
export enum AgentAutonomy {
  PROPOSE = 'PROPOSE',
  ACT_LOW = 'ACT_LOW',
  AUTONOMOUS = 'AUTONOMOUS',
}

/**
 * Which MUTATING/SENSITIVE tiers a given autonomy level auto-approves.
 * READ/LOW are never listed — they execute live regardless (palier 1).
 * Caps (amount/rate) still bound auto-approved actions at execution time.
 */
export function autoApprovedTiers(level: AgentAutonomy): RiskTier[] {
  switch (level) {
    case AgentAutonomy.PROPOSE:
      return [];
    case AgentAutonomy.ACT_LOW:
      return [RiskTier.MUTATING];
    case AgentAutonomy.AUTONOMOUS:
      return [RiskTier.MUTATING, RiskTier.SENSITIVE];
  }
}
