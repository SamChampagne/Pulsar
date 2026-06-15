import { describe, it, expect } from 'vitest';
import { AgentRunStatus, AgentRunTrigger, classifyRunError } from './runs';

describe('AgentRun enums + classifyRunError', () => {
  it('exposes the six run statuses and three triggers', () => {
    expect(Object.values(AgentRunStatus)).toEqual([
      'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'KILLED',
    ]);
    expect(Object.values(AgentRunTrigger)).toEqual(['EVENT', 'CRON', 'MANUAL']);
  });

  it('classifies connectivity errors as retry, not-installed as skip, rest terminal', () => {
    expect(classifyRunError('ServiceUnavailableException')).toBe('retry');
    expect(classifyRunError('BadRequestException')).toBe('skip');
    expect(classifyRunError('Error')).toBe('terminal');
    expect(classifyRunError('TypeError')).toBe('terminal');
  });
});
