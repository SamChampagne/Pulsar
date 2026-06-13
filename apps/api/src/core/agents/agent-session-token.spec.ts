import { mintAgentSessionToken, verifyAgentSessionToken } from './agent-session-token';

const SECRET = 'test-secret-please-change';

describe('agent session token', () => {
  it('round-trips agentId for a valid unexpired token', () => {
    const token = mintAgentSessionToken('agent_123', SECRET, 60, 1_000_000);
    expect(verifyAgentSessionToken(token, SECRET, 1_000_030)).toBe('agent_123');
  });
  it('rejects an expired token', () => {
    const token = mintAgentSessionToken('agent_123', SECRET, 60, 1_000_000);
    expect(verifyAgentSessionToken(token, SECRET, 1_000_061)).toBeNull();
  });
  it('rejects a tampered token', () => {
    const token = mintAgentSessionToken('agent_123', SECRET, 60, 1_000_000);
    expect(verifyAgentSessionToken(token + 'x', SECRET, 1_000_010)).toBeNull();
  });
  it('rejects a token signed with a different secret', () => {
    const token = mintAgentSessionToken('agent_123', SECRET, 60, 1_000_000);
    expect(verifyAgentSessionToken(token, 'other', 1_000_010)).toBeNull();
  });
  it('does not collide with a real ak_ key (returns null for non-prefixed input)', () => {
    expect(verifyAgentSessionToken('ak_abcdef', SECRET, 1_000_010)).toBeNull();
  });
});
