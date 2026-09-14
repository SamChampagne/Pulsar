import { describe, expect, it } from 'vitest';
import { deriveQueueState } from './control-center';
describe('operations queue observations', () => {
  const now = Date.parse('2026-09-14T12:00:00Z');
  it('does not equate no activity with health', () =>
    expect(deriveQueueState(0, 0, null, null, now)).toBe('UNVERIFIED'));
  it('reports a recorded failure', () =>
    expect(deriveQueueState(0, 1, null, '2026-09-14T11:59:00Z', now)).toBe('DEGRADED'));
  it('reports a stale backlog', () =>
    expect(deriveQueueState(1, 0, '2026-09-14T11:00:00Z', '2026-09-14T11:00:00Z', now)).toBe(
      'DEGRADED',
    ));
  it('accepts recent observed activity', () =>
    expect(deriveQueueState(1, 0, '2026-09-14T11:59:00Z', '2026-09-14T11:59:00Z', now)).toBe(
      'OPERATIONAL',
    ));
});
