import { describe, expect, it } from 'vitest';
import {
  canTransitionCrmSequenceRun,
  canTransitionCrmSequenceStep,
  renderSequenceText,
  sequenceEmailHtml,
  sequenceStepDue,
} from './sequences';

describe('CRM sequence contracts', () => {
  it('supports pause/resume and terminal stop', () => {
    expect(canTransitionCrmSequenceRun('ACTIVE', 'PAUSED')).toBe(true);
    expect(canTransitionCrmSequenceRun('PAUSED', 'ACTIVE')).toBe(true);
    expect(canTransitionCrmSequenceRun('PAUSED', 'STOPPED')).toBe(true);
    for (const status of ['STOPPED', 'FAILED', 'COMPLETED', 'UNKNOWN'])
      expect(canTransitionCrmSequenceRun(status, 'ACTIVE')).toBe(false);
  });
  it('never replays a terminal step', () => {
    expect(canTransitionCrmSequenceStep('PENDING', 'SIMULATED')).toBe(true);
    expect(canTransitionCrmSequenceStep('PROPOSED', 'QUEUED')).toBe(true);
    expect(canTransitionCrmSequenceStep('QUEUED', 'SENT')).toBe(true);
    for (const status of ['SENT', 'SIMULATED', 'FAILED', 'CANCELLED'])
      expect(canTransitionCrmSequenceStep(status, 'PENDING')).toBe(false);
  });
  it('renders only supported variables and escapes HTML after interpolation', () => {
    const text = renderSequenceText('Bonjour {{ name }}\n{{company}}', {
      name: '<Sam>',
      company: 'A & B',
    });
    expect(sequenceEmailHtml(text)).toBe('Bonjour &lt;Sam&gt;<br>A &amp; B');
    expect(() => renderSequenceText('{{email}}', { name: '', company: '' })).toThrow(
      'Variable inconnue',
    );
  });
  it('uses an explicit relative time, including immediate first step', () => {
    const base = new Date('2026-09-14T10:00:00Z');
    expect(sequenceStepDue(base, 0).toISOString()).toBe(base.toISOString());
    expect(sequenceStepDue(base, 1440).toISOString()).toBe('2026-09-15T10:00:00.000Z');
  });
});
