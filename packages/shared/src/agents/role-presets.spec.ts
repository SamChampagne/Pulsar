import { describe, it, expect } from 'vitest';
import { AGENT_ROLE_PRESETS } from './role-presets';
import { AgentAutonomy } from './autonomy';
import { ALL_PERMISSION_KEYS } from '../permissions';

describe('AGENT_ROLE_PRESETS', () => {
  it('each preset has persona, valid permissions, valid autonomy', () => {
    const valid = new Set<string>(ALL_PERMISSION_KEYS);
    for (const p of AGENT_ROLE_PRESETS) {
      expect(p.id).toBeTruthy();
      expect(p.persona.length).toBeGreaterThan(0);
      expect(Object.values(AgentAutonomy)).toContain(p.suggestedAutonomy);
      for (const k of p.suggestedPermissions) expect(valid.has(k)).toBe(true);
    }
  });
  it('ids unique', () => {
    const ids = AGENT_ROLE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('always-on presets carry categories + operating.tasks read|manage + a cap', () => {
    const alwaysOn = AGENT_ROLE_PRESETS.filter((p) => p.alwaysOn);
    expect(alwaysOn.length).toBeGreaterThanOrEqual(3);
    for (const p of alwaysOn) {
      expect(p.handlesCategories && p.handlesCategories.length).toBeTruthy();
      // Must be able to read AND resolve its own tasks.
      expect(p.suggestedPermissions).toContain('core.operating.tasks.read');
      expect(p.suggestedPermissions).toContain('core.operating.tasks.manage');
      // A 24/7 worker that acts needs a hard amount cap suggested.
      expect(typeof p.suggestedMaxAmountPerAction).toBe('number');
      expect(p.suggestedMaxAmountPerAction as number).toBeGreaterThan(0);
    }
  });

  it('exposes the expected always-on roles', () => {
    const ids = new Set(AGENT_ROLE_PRESETS.filter((p) => p.alwaysOn).map((p) => p.id));
    expect(ids).toContain('tender-desk');
    expect(ids).toContain('freight-auditor');
    expect(ids).toContain('fleet-maintenance');
    expect(ids).toContain('crm-sdr');
  });

  it('non-always-on presets do not declare categories', () => {
    for (const p of AGENT_ROLE_PRESETS.filter((p) => !p.alwaysOn)) {
      expect(p.handlesCategories).toBeUndefined();
    }
  });
});
