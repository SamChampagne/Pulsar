import { describe, it, expect } from 'vitest';
import {
  DispatchPlanStatus,
  canTransitionDispatchPlan,
  isDispatchPlanOpen,
} from './dispatch-plan.workflow';

describe('canTransitionDispatchPlan', () => {
  it('allows DRAFT → PROPOSED and DRAFT → DISCARDED', () => {
    expect(canTransitionDispatchPlan(DispatchPlanStatus.DRAFT, DispatchPlanStatus.PROPOSED)).toBe(true);
    expect(canTransitionDispatchPlan(DispatchPlanStatus.DRAFT, DispatchPlanStatus.DISCARDED)).toBe(true);
  });

  it('allows PROPOSED → COMMITTED and PROPOSED → DISCARDED', () => {
    expect(canTransitionDispatchPlan(DispatchPlanStatus.PROPOSED, DispatchPlanStatus.COMMITTED)).toBe(true);
    expect(canTransitionDispatchPlan(DispatchPlanStatus.PROPOSED, DispatchPlanStatus.DISCARDED)).toBe(true);
  });

  it('forbids skipping DRAFT → COMMITTED', () => {
    expect(canTransitionDispatchPlan(DispatchPlanStatus.DRAFT, DispatchPlanStatus.COMMITTED)).toBe(false);
  });

  it('treats COMMITTED and DISCARDED as terminal', () => {
    for (const to of Object.values(DispatchPlanStatus)) {
      expect(canTransitionDispatchPlan(DispatchPlanStatus.COMMITTED, to)).toBe(false);
      expect(canTransitionDispatchPlan(DispatchPlanStatus.DISCARDED, to)).toBe(false);
    }
  });

  it('isDispatchPlanOpen is true only for DRAFT/PROPOSED', () => {
    expect(isDispatchPlanOpen(DispatchPlanStatus.DRAFT)).toBe(true);
    expect(isDispatchPlanOpen(DispatchPlanStatus.PROPOSED)).toBe(true);
    expect(isDispatchPlanOpen(DispatchPlanStatus.COMMITTED)).toBe(false);
    expect(isDispatchPlanOpen(DispatchPlanStatus.DISCARDED)).toBe(false);
  });
});
