import { MODULE_KEYS, PERMISSIONS, RiskTier, isExecutableLive } from '@pulsar/shared';
import { TOOL_BY_NAME } from '../tool-registry';
import { manufacturingTools } from './manufacturing.tools';

describe('manufacturing agent tools', () => {
  it('are all registered in the global tool registry under the MANUFACTURING module', () => {
    for (const tool of manufacturingTools) {
      expect(TOOL_BY_NAME.get(tool.name)).toBe(tool);
      expect(tool.module).toBe(MODULE_KEYS.MANUFACTURING);
      expect([PERMISSIONS.MANUFACTURING.READ, PERMISSIONS.MANUFACTURING.MANAGE]).toContain(
        tool.permission,
      );
    }
  });

  it('classifies governance correctly: reads + run execute live, publish is queued', () => {
    const byName = new Map(manufacturingTools.map((t) => [t.name, t]));
    // Reads + the candidate run execute live (no human gate).
    for (const name of ['list_manufacturing_orders', 'get_manufacturing_plan', 'list_scheduling_runs']) {
      expect(byName.get(name)!.tier).toBe(RiskTier.READ);
      expect(isExecutableLive(byName.get(name)!.tier)).toBe(true);
    }
    expect(byName.get('run_manufacturing_schedule')!.tier).toBe(RiskTier.LOW);
    expect(isExecutableLive(byName.get('run_manufacturing_schedule')!.tier)).toBe(true);
    // Publishing the operational baseline is a committing action → governance queue.
    expect(byName.get('publish_manufacturing_baseline')!.tier).toBe(RiskTier.MUTATING);
    expect(isExecutableLive(byName.get('publish_manufacturing_baseline')!.tier)).toBe(false);
  });

  it('write tools require manufacturing.manage', () => {
    const byName = new Map(manufacturingTools.map((t) => [t.name, t]));
    expect(byName.get('run_manufacturing_schedule')!.permission).toBe(PERMISSIONS.MANUFACTURING.MANAGE);
    expect(byName.get('publish_manufacturing_baseline')!.permission).toBe(PERMISSIONS.MANUFACTURING.MANAGE);
  });
});
