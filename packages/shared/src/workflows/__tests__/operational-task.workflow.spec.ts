import { describe, expect, it } from 'vitest';
import { OperationalTaskStatus as S } from '../../enums/operating';
import { canTransitionOperationalTask } from '../operational-task.workflow';

describe('canTransitionOperationalTask', () => {
  it('allows OPEN → IN_PROGRESS, RESOLVED, DISMISSED', () => {
    expect(canTransitionOperationalTask(S.OPEN, S.IN_PROGRESS)).toBe(true);
    expect(canTransitionOperationalTask(S.OPEN, S.RESOLVED)).toBe(true);
    expect(canTransitionOperationalTask(S.OPEN, S.DISMISSED)).toBe(true);
  });
  it('allows IN_PROGRESS → RESOLVED, DISMISSED, OPEN', () => {
    expect(canTransitionOperationalTask(S.IN_PROGRESS, S.RESOLVED)).toBe(true);
    expect(canTransitionOperationalTask(S.IN_PROGRESS, S.DISMISSED)).toBe(true);
    expect(canTransitionOperationalTask(S.IN_PROGRESS, S.OPEN)).toBe(true);
  });
  it('treats RESOLVED and DISMISSED as terminal', () => {
    expect(canTransitionOperationalTask(S.RESOLVED, S.OPEN)).toBe(false);
    expect(canTransitionOperationalTask(S.DISMISSED, S.IN_PROGRESS)).toBe(false);
  });
  it('rejects no-op transitions', () => {
    expect(canTransitionOperationalTask(S.OPEN, S.OPEN)).toBe(false);
  });
});
