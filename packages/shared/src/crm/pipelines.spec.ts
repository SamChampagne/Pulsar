import { describe, expect, it } from 'vitest';
import { canMoveCrmStage, DEFAULT_CRM_STAGES, validateCrmPipelineStages } from './pipelines';
import { CrmDealStage as K } from './crm.workflow';
describe('configurable CRM columns', () => {
  it('allows multiple columns in the same open phase, not a no-op', () => {
    expect(canMoveCrmStage({ id: 'a', kind: K.PROPOSAL }, { id: 'b', kind: K.PROPOSAL })).toBe(
      true,
    );
    expect(canMoveCrmStage({ id: 'a', kind: K.LEAD }, { id: 'a', kind: K.LEAD })).toBe(false);
  });
  it('preserves terminal outcomes', () => {
    for (const kind of [K.WON, K.LOST])
      for (const to of Object.values(K))
        expect(canMoveCrmStage({ id: 'a', kind }, { id: 'b', kind: to })).toBe(false);
  });
  it('validates names and mandatory outcomes', () => {
    expect(validateCrmPipelineStages([...DEFAULT_CRM_STAGES])).toBeNull();
    expect(validateCrmPipelineStages(DEFAULT_CRM_STAGES.slice(0, 3))).toBeTruthy();
    expect(
      validateCrmPipelineStages([...DEFAULT_CRM_STAGES, { name: ' prospect ', kind: K.LEAD }]),
    ).toBeTruthy();
  });
});
