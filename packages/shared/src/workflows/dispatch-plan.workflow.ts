// Pure, browser-safe. No Node imports.
// Continuous Planning v1 — versioned dispatch plan lifecycle (PlanProposal/PlanCommit).
export enum DispatchPlanStatus {
  DRAFT = 'DRAFT',
  PROPOSED = 'PROPOSED',
  COMMITTED = 'COMMITTED',
  DISCARDED = 'DISCARDED',
}

const TRANSITIONS: Record<DispatchPlanStatus, DispatchPlanStatus[]> = {
  [DispatchPlanStatus.DRAFT]: [DispatchPlanStatus.PROPOSED, DispatchPlanStatus.DISCARDED],
  [DispatchPlanStatus.PROPOSED]: [DispatchPlanStatus.COMMITTED, DispatchPlanStatus.DISCARDED],
  [DispatchPlanStatus.COMMITTED]: [],
  [DispatchPlanStatus.DISCARDED]: [],
};

export function canTransitionDispatchPlan(
  from: DispatchPlanStatus,
  to: DispatchPlanStatus,
): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Open = still mutable/actionable (not COMMITTED or DISCARDED). */
export function isDispatchPlanOpen(s: DispatchPlanStatus): boolean {
  return s === DispatchPlanStatus.DRAFT || s === DispatchPlanStatus.PROPOSED;
}
