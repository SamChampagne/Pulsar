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
});
