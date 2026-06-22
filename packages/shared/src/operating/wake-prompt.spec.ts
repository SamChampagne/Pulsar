import { describe, it, expect } from 'vitest';
import { buildWakePrompt, canSelfResolve, type WakeTaskContext } from './wake-prompt';

const base: WakeTaskContext = {
  id: 'task_1',
  category: 'TENDER_FAILURE',
  title: 'Tender declined on load LD-000107',
  description: null,
  severity: 'WARNING',
  subjectType: 'load',
  subjectId: 'LD-000107',
  slaDueAt: '2026-06-22T22:00:00.000Z',
};

describe('canSelfResolve', () => {
  it('only ACT_LOW / AUTONOMOUS may self-resolve', () => {
    expect(canSelfResolve('AUTONOMOUS')).toBe(true);
    expect(canSelfResolve('ACT_LOW')).toBe(true);
    expect(canSelfResolve('PROPOSE')).toBe(false);
  });
});

describe('buildWakePrompt', () => {
  it('includes the task context (category, title, subject, severity, sla)', () => {
    const p = buildWakePrompt(base, 'AUTONOMOUS');
    expect(p).toContain('TENDER_FAILURE');
    expect(p).toContain('Tender declined on load LD-000107');
    expect(p).toContain('load LD-000107');
    expect(p).toContain('WARNING');
    expect(p).toContain('2026-06-22T22:00:00.000Z');
    expect(p).toContain(base.id);
  });

  it('embeds the category playbook checklist', () => {
    const p = buildWakePrompt(base, 'AUTONOMOUS');
    // From PLAYBOOKS.TENDER_FAILURE
    expect(p).toContain('Lancer une nouvelle soumission vers un transporteur alternatif');
  });

  it('falls back to the default playbook for an unknown category', () => {
    const p = buildWakePrompt({ ...base, category: 'NOPE' }, 'AUTONOMOUS');
    expect(p).toContain('Analyser la situation et identifier la cause racine');
  });

  it('AUTONOMOUS/ACT_LOW directs the agent to act and call resolve_task', () => {
    for (const a of ['AUTONOMOUS', 'ACT_LOW'] as const) {
      const p = buildWakePrompt(base, a);
      expect(p).toContain('resolve_task');
      expect(p).toContain('Exécute les actions correctives');
      expect(p).not.toContain('Ne clôture PAS');
    }
  });

  it('PROPOSE directs the agent to propose only and NOT close the task', () => {
    const p = buildWakePrompt(base, 'PROPOSE');
    expect(p).toContain('Ne clôture PAS');
    expect(p).toContain('validation humaine');
    expect(p).not.toContain('resolve_task');
  });

  it('omits optional fields that are null', () => {
    const p = buildWakePrompt(
      { ...base, title: null, description: null, severity: null, subjectType: null, subjectId: null, slaDueAt: null },
      'PROPOSE',
    );
    expect(p).not.toContain('Titre :');
    expect(p).not.toContain('Sujet concerné :');
    expect(p).not.toContain('Échéance SLA :');
    expect(p).toContain('TENDER_FAILURE');
  });
});
