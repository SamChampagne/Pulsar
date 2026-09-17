import { describe, it, expect } from 'vitest';
import { mrpWorkerEligible } from './mrp-worker';
import { AGENT_ROLE_PRESETS } from '../agents/role-presets';
import { DOMAIN_EVENT_TYPES, resolvePolicies } from '../operating/policies';
import { moduleOfEventType, moduleOfSubjectType } from '../analytics/flow';

describe('MRP worker contract', () => {
  const preset = AGENT_ROLE_PRESETS.find((p) => p.id === 'mrp-analyst')!;
  const modules = new Set(['manufacturing', 'wms', 'crm']);
  const agent = () => ({
    permissions: preset.suggestedPermissions,
    caps: {
      alwaysOn: true,
      handlesCategories: ['MRP_REVIEW'],
      toolAllowlist: preset.suggestedToolAllowlist,
    },
  });
  it('offers a propose-only least-privilege role, without the LOW task resolver', () => {
    expect(preset.suggestedAutonomy).toBe('PROPOSE');
    expect(mrpWorkerEligible(agent(), modules, true)).toBe(true);
    expect(preset.suggestedToolAllowlist).not.toContain('resolve_task');
  });
  it('requires current cross-module rights and all review tools', () => {
    expect(mrpWorkerEligible(agent(), new Set(['manufacturing']), false)).toBe(false);
    const withoutCrm = {
      ...agent(),
      permissions: preset.suggestedPermissions.filter((p) => p !== 'crm.read'),
    };
    expect(mrpWorkerEligible(withoutCrm, modules, true)).toBe(false);
    expect(mrpWorkerEligible(withoutCrm, modules, false)).toBe(true);
    expect(
      mrpWorkerEligible(
        { ...agent(), caps: { ...agent().caps, toolAllowlist: ['get_mrp_run'] } },
        modules,
        true,
      ),
    ).toBe(false);
    expect(
      mrpWorkerEligible({ ...agent(), caps: { ...agent().caps, alwaysOn: false } }, modules, true),
    ).toBe(false);
  });
  it('creates one minimal task per run, without exposing commercial data in operating tasks', () => {
    const [task] = resolvePolicies({
      type: DOMAIN_EVENT_TYPES.MRP_REVIEW_REQUESTED,
      payload: {
        runId: 'r1',
        requiresCrm: true,
        exceptionCount: 3,
        client: 'private',
        quantity: '300',
      },
    });
    expect(task).toMatchObject({
      dedupKey: 'MRP_REVIEW:r1',
      category: 'MRP_REVIEW',
      severity: 'WARNING',
      subjectType: 'mrp-run',
      subjectId: 'r1',
      assignHint: 'AUTO',
    });
    expect(task.details).toEqual({ runId: 'r1', requiresCrm: true });
    expect(resolvePolicies({ type: DOMAIN_EVENT_TYPES.MRP_REVIEW_REQUESTED, payload: {} })).toEqual(
      [],
    );
    expect(moduleOfEventType(DOMAIN_EVENT_TYPES.MRP_REVIEW_REQUESTED)).toBe('MANUFACTURING');
    expect(moduleOfSubjectType('mrp-run')).toBe('MANUFACTURING');
  });
});
