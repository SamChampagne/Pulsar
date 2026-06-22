import { describe, it, expect } from 'vitest';
import { REACTION_CATALOG, reactionByKey } from './reactions';
import { produceRuleReaction, type AutomationRuleLike } from './rules';

describe('REACTION_CATALOG', () => {
  it('contains the 2 v1 reactions with required modules', () => {
    const keys = REACTION_CATALOG.map((r) => r.key);
    expect(keys).toContain('create_picks_for_order');
    expect(keys).toContain('draft_customer_invoice');
    expect(reactionByKey('create_picks_for_order')?.requiredModules).toContain('wms');
    expect(reactionByKey('draft_customer_invoice')?.requiredModules).toContain('billing');
    expect(reactionByKey('nope')).toBeUndefined();
  });
});

describe('produceRuleReaction', () => {
  const rule: AutomationRuleLike = {
    id: 'r1', eventType: 'transport-order.planned', match: 'ALL', conditions: [],
    action: { kind: 'RUN_ACTION', action: 'create_picks_for_order', args: { orderId: '{orderId}' } },
  };
  it('interpolates args from the payload', () => {
    const cmd = produceRuleReaction(rule, { type: 'transport-order.planned', payload: { orderId: 'O-1' } });
    expect(cmd).toEqual({ ruleId: 'r1', action: 'create_picks_for_order', args: { orderId: 'O-1' } });
  });
  it('returns null for a CREATE_TASK rule', () => {
    const taskRule: AutomationRuleLike = { ...rule, action: { kind: 'CREATE_TASK', category: 'X', severity: 'INFO', titleTemplate: 't', assignHint: 'AUTO' } };
    expect(produceRuleReaction(taskRule, { type: 'transport-order.planned', payload: {} })).toBeNull();
  });
});

describe('arc E reactions in catalogue', () => {
  it.each(['open_maintenance_order', 'assign_dock_appointment', 'close_delivered_transport_order'])(
    'exposes %s with required module + argKeys',
    (key) => {
      const d = reactionByKey(key);
      expect(d).toBeDefined();
      expect(d!.requiredModules.length).toBeGreaterThan(0);
      expect(d!.argKeys.length).toBeGreaterThan(0);
    },
  );
});
