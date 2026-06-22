import { describe, expect, it } from 'vitest';
import { OperationalTaskType } from '../enums/operating';
import type { DomainEventInput } from '../operating/policies';
import {
  getByPath,
  evaluateRuleConditions,
  interpolateTemplate,
  produceRuleTaskSpec,
  AUTOMATION_EVENT_CATALOG,
  RULE_OPERATORS,
  SUGGESTED_TASK_CATEGORIES,
  type AutomationRuleLike,
  type CreateTaskAction,
  type RuleCondition,
} from './rules';

describe('getByPath', () => {
  const obj = { a: { b: { c: 42 } }, subject: { id: 'x1' }, flat: 'v' };

  it('reads a nested value', () => {
    expect(getByPath(obj, 'a.b.c')).toBe(42);
    expect(getByPath(obj, 'subject.id')).toBe('x1');
    expect(getByPath(obj, 'flat')).toBe('v');
  });

  it('returns undefined for a missing segment', () => {
    expect(getByPath(obj, 'a.x')).toBeUndefined();
    expect(getByPath(obj, 'a.b.c.d')).toBeUndefined();
    expect(getByPath(obj, 'nope')).toBeUndefined();
  });

  it('returns undefined for empty path or non-object root', () => {
    expect(getByPath(obj, '')).toBeUndefined();
    expect(getByPath(null, 'a')).toBeUndefined();
    expect(getByPath(5, 'a')).toBeUndefined();
  });
});

describe('evaluateRuleConditions — operators', () => {
  const payload = { n: 10, s: 'hello world', t: true, missing: undefined };

  const c = (field: string, operator: RuleCondition['operator'], value?: RuleCondition['value']): RuleCondition => ({
    field,
    operator,
    value,
  });

  it('eq / neq (loose, bridges string vs number)', () => {
    expect(evaluateRuleConditions([c('n', 'eq', 10)], 'ALL', payload)).toBe(true);
    expect(evaluateRuleConditions([c('n', 'eq', '10')], 'ALL', payload)).toBe(true);
    expect(evaluateRuleConditions([c('n', 'eq', 9)], 'ALL', payload)).toBe(false);
    expect(evaluateRuleConditions([c('n', 'neq', 9)], 'ALL', payload)).toBe(true);
    expect(evaluateRuleConditions([c('n', 'neq', 10)], 'ALL', payload)).toBe(false);
  });

  it('gt / gte / lt / lte (numeric)', () => {
    expect(evaluateRuleConditions([c('n', 'gt', 5)], 'ALL', payload)).toBe(true);
    expect(evaluateRuleConditions([c('n', 'gt', 10)], 'ALL', payload)).toBe(false);
    expect(evaluateRuleConditions([c('n', 'gte', 10)], 'ALL', payload)).toBe(true);
    expect(evaluateRuleConditions([c('n', 'lt', 20)], 'ALL', payload)).toBe(true);
    expect(evaluateRuleConditions([c('n', 'lt', 10)], 'ALL', payload)).toBe(false);
    expect(evaluateRuleConditions([c('n', 'lte', 10)], 'ALL', payload)).toBe(true);
  });

  it('gt is false when the actual value is not numeric', () => {
    expect(evaluateRuleConditions([c('s', 'gt', 5)], 'ALL', payload)).toBe(false);
  });

  it('contains (string substring)', () => {
    expect(evaluateRuleConditions([c('s', 'contains', 'world')], 'ALL', payload)).toBe(true);
    expect(evaluateRuleConditions([c('s', 'contains', 'nope')], 'ALL', payload)).toBe(false);
  });

  it('exists / not_exists', () => {
    expect(evaluateRuleConditions([c('n', 'exists')], 'ALL', payload)).toBe(true);
    expect(evaluateRuleConditions([c('missing', 'exists')], 'ALL', payload)).toBe(false);
    expect(evaluateRuleConditions([c('absent', 'exists')], 'ALL', payload)).toBe(false);
    expect(evaluateRuleConditions([c('absent', 'not_exists')], 'ALL', payload)).toBe(true);
    expect(evaluateRuleConditions([c('n', 'not_exists')], 'ALL', payload)).toBe(false);
  });
});

describe('evaluateRuleConditions — ALL vs ANY vs empty', () => {
  const payload = { n: 10, s: 'abc' };
  const pass: RuleCondition = { field: 'n', operator: 'eq', value: 10 };
  const fail: RuleCondition = { field: 'n', operator: 'eq', value: 0 };

  it('empty conditions ⇒ true', () => {
    expect(evaluateRuleConditions([], 'ALL', payload)).toBe(true);
    expect(evaluateRuleConditions([], 'ANY', payload)).toBe(true);
  });

  it('ALL requires every condition', () => {
    expect(evaluateRuleConditions([pass, pass], 'ALL', payload)).toBe(true);
    expect(evaluateRuleConditions([pass, fail], 'ALL', payload)).toBe(false);
  });

  it('ANY requires at least one condition', () => {
    expect(evaluateRuleConditions([fail, pass], 'ANY', payload)).toBe(true);
    expect(evaluateRuleConditions([fail, fail], 'ANY', payload)).toBe(false);
  });
});

describe('interpolateTemplate', () => {
  const payload = { kind: 'DAMAGE', loadNumber: 'LD-42', subject: { id: 'x1' } };

  it('replaces present fields', () => {
    expect(interpolateTemplate('Exception {kind} sur {loadNumber}', payload)).toBe(
      'Exception DAMAGE sur LD-42',
    );
  });

  it('replaces nested paths', () => {
    expect(interpolateTemplate('Sujet {subject.id}', payload)).toBe('Sujet x1');
  });

  it('emits empty string for missing fields', () => {
    expect(interpolateTemplate('A{missing}B', payload)).toBe('AB');
  });

  it('handles empty template', () => {
    expect(interpolateTemplate('', payload)).toBe('');
  });

  it('trims whitespace inside tokens', () => {
    expect(interpolateTemplate('{ kind }', payload)).toBe('DAMAGE');
  });
});

describe('produceRuleTaskSpec', () => {
  const baseRule: AutomationRuleLike = {
    id: 'rule-1',
    eventType: 'stop.delayed',
    match: 'ALL',
    conditions: [],
    action: {
      kind: 'CREATE_TASK',
      category: 'CUSTOM_DELAY',
      severity: 'WARNING',
      titleTemplate: 'Retard {minutesLate} min',
      assignHint: 'AUTO',
    },
  };

  it('produces an EXCEPTION TaskSpec with dedupKey rule:<id>:<subjectId>', () => {
    const event: DomainEventInput = {
      type: 'stop.delayed',
      payload: { id: 's1', minutesLate: 45 },
    };
    const spec = produceRuleTaskSpec(baseRule, event);
    expect(spec).not.toBeNull();
    expect(spec!.type).toBe(OperationalTaskType.EXCEPTION);
    expect(spec!.category).toBe('CUSTOM_DELAY');
    expect(spec!.severity).toBe('WARNING');
    expect(spec!.title).toBe('Retard 45 min');
    expect(spec!.assignHint).toBe('AUTO');
    expect(spec!.dedupKey).toBe('rule:rule-1:s1');
  });

  it('resolves subjectId via action.subjectField first', () => {
    const rule: AutomationRuleLike = {
      ...baseRule,
      action: { ...baseRule.action, subjectField: 'stopId' } as CreateTaskAction,
    };
    const event: DomainEventInput = {
      type: 'stop.delayed',
      payload: { stopId: 's1', subjectId: 'sub1', id: 'id1' },
    };
    const spec = produceRuleTaskSpec(rule, event);
    expect(spec!.subjectId).toBe('s1');
    expect(spec!.dedupKey).toBe('rule:rule-1:s1');
  });

  it('falls back to payload.subjectId when subjectField is absent', () => {
    const event: DomainEventInput = {
      type: 'stop.delayed',
      payload: { subjectId: 'sub1', id: 'id1' },
    };
    const spec = produceRuleTaskSpec(baseRule, event);
    expect(spec!.subjectId).toBe('sub1');
    expect(spec!.dedupKey).toBe('rule:rule-1:sub1');
  });

  it('falls back to payload.id when subjectId is absent', () => {
    const event: DomainEventInput = { type: 'stop.delayed', payload: { id: 'id1' } };
    const spec = produceRuleTaskSpec(baseRule, event);
    expect(spec!.subjectId).toBe('id1');
    expect(spec!.dedupKey).toBe('rule:rule-1:id1');
  });

  it('falls back to event-level subjectId last', () => {
    const event = {
      type: 'stop.delayed',
      payload: {},
      subjectId: 'ev-sub',
    } as unknown as DomainEventInput;
    const spec = produceRuleTaskSpec(baseRule, event);
    expect(spec!.subjectId).toBe('ev-sub');
    expect(spec!.dedupKey).toBe('rule:rule-1:ev-sub');
  });

  it('coerces a numeric subjectId to string', () => {
    const event: DomainEventInput = { type: 'stop.delayed', payload: { id: 7 } };
    const spec = produceRuleTaskSpec(baseRule, event);
    expect(spec!.subjectId).toBe('7');
  });

  it('returns null when no subjectId can be resolved', () => {
    const event: DomainEventInput = { type: 'stop.delayed', payload: { foo: 'bar' } };
    expect(produceRuleTaskSpec(baseRule, event)).toBeNull();
  });

  it('defaults subjectType to the event type, override via action.subjectType', () => {
    const event: DomainEventInput = { type: 'stop.delayed', payload: { id: 'id1' } };
    expect(produceRuleTaskSpec(baseRule, event)!.subjectType).toBe('stop.delayed');

    const rule: AutomationRuleLike = {
      ...baseRule,
      action: { ...baseRule.action, subjectType: 'stop' } as CreateTaskAction,
    };
    expect(produceRuleTaskSpec(rule, event)!.subjectType).toBe('stop');
  });

  it('copies the full payload into details', () => {
    const event: DomainEventInput = { type: 'stop.delayed', payload: { id: 'id1', extra: 9 } };
    const spec = produceRuleTaskSpec(baseRule, event);
    expect(spec!.details).toEqual({ id: 'id1', extra: 9 });
  });
});

describe('catalog data', () => {
  it('has one descriptor per DOMAIN_EVENT_TYPES value (19)', () => {
    expect(AUTOMATION_EVENT_CATALOG).toHaveLength(19);
    const types = new Set(AUTOMATION_EVENT_CATALOG.map((e) => e.type));
    expect(types.size).toBe(19);
  });

  it('every descriptor has fields and a defaultSubjectField', () => {
    for (const d of AUTOMATION_EVENT_CATALOG) {
      expect(d.fields.length).toBeGreaterThan(0);
      expect(d.defaultSubjectField).toBeTruthy();
    }
  });

  it('exposes all 9 operators and the 11 suggested categories', () => {
    expect(RULE_OPERATORS).toHaveLength(9);
    expect(SUGGESTED_TASK_CATEGORIES).toHaveLength(11);
  });
});
