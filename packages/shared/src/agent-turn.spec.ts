import { describe, expect, it } from 'vitest';
import { parseAgentTurnResult, agentTurnMessage } from './agent-turn';

describe('agent turn closed contract', () => {
  it.each([
    undefined,
    null,
    {},
    { version: 2, status: 'succeeded' },
    { version: 1, status: 'unknown' },
  ])('does not infer success from %j', (value) => {
    expect(parseAgentTurnResult(value)).toEqual({
      version: 1,
      status: 'failed',
      code: 'PROTOCOL_ERROR',
    });
  });
  it('projects outcomes without provider diagnostics or credentials', () => {
    expect(
      parseAgentTurnResult({
        version: 1,
        status: 'failed',
        code: 'RUNTIME_FAILURE',
        secret: 'key',
        error: 'private',
      }),
    ).toEqual({ version: 1, status: 'failed', code: 'RUNTIME_FAILURE' });
  });
  it('keeps cancellation distinct from failure and never promises undo', () => {
    const result = parseAgentTurnResult({ version: 1, status: 'cancelled' });
    expect(result.status).toBe('cancelled');
    expect(agentTurnMessage(result)).toContain('ne sont pas annulées');
  });
  it('retains observed cumulative zero and never turns unknown counts into zero', () => {
    expect(
      parseAgentTurnResult({
        version: 1,
        status: 'succeeded',
        usage: {
          scope: 'runtime_session',
          inputTokens: 0,
          outputTokens: -5,
          totalTokens: Infinity,
        },
      }).usage,
    ).toEqual({ scope: 'runtime_session', inputTokens: 0, outputTokens: null, totalTokens: null });
  });
  it('rejects an unrecognized accounting scope', () => {
    expect(
      parseAgentTurnResult({
        version: 1,
        status: 'succeeded',
        usage: { scope: 'invoice', totalTokens: 50 },
      }).usage,
    ).toBeUndefined();
  });
});
