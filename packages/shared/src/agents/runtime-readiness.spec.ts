import { describe, it, expect } from 'vitest';
import { deriveRuntimeReadiness, runtimeBlockMessage, type RuntimeReadinessInput } from './runtime-readiness';

const base: RuntimeReadinessInput = {
  installed: true,
  configured: true,
  authMode: 'apiKey',
  hasApiKey: true,
  connected: false,
  hasModel: true,
  lastTestOk: true,
};

describe('deriveRuntimeReadiness', () => {
  it('is ready when every precondition passes (apiKey provider)', () => {
    const r = deriveRuntimeReadiness(base);
    expect(r.ready).toBe(true);
    expect(r.blockReason).toBeNull();
    expect(r.authReady).toBe(true);
    expect(r.modelReady).toBe(true);
  });

  it('is ready for a login provider when connected (key not required)', () => {
    const r = deriveRuntimeReadiness({ ...base, authMode: 'login', hasApiKey: false, connected: true });
    expect(r.ready).toBe(true);
    expect(r.authReady).toBe(true);
  });

  it('reports preconditions in priority order — install first', () => {
    // Everything is broken at once; the earliest failing precondition wins.
    const r = deriveRuntimeReadiness({
      installed: false,
      configured: false,
      authMode: null,
      hasApiKey: false,
      connected: false,
      hasModel: false,
      lastTestOk: false,
    });
    expect(r.blockReason).toBe('not-installed');
    expect(r.ready).toBe(false);
  });

  it('not-configured when installed but no config', () => {
    expect(deriveRuntimeReadiness({ ...base, configured: false, authMode: null, hasApiKey: false }).blockReason).toBe(
      'not-configured',
    );
  });

  it('auth-missing for an apiKey provider without a stored key', () => {
    const r = deriveRuntimeReadiness({ ...base, hasApiKey: false });
    expect(r.blockReason).toBe('auth-missing');
    expect(r.authReady).toBe(false);
  });

  it('auth-missing for a login provider that has not connected', () => {
    const r = deriveRuntimeReadiness({ ...base, authMode: 'login', hasApiKey: false, connected: false });
    expect(r.blockReason).toBe('auth-missing');
  });

  it('a stored api key does not satisfy a login provider', () => {
    const r = deriveRuntimeReadiness({ ...base, authMode: 'login', hasApiKey: true, connected: false });
    expect(r.authReady).toBe(false);
    expect(r.blockReason).toBe('auth-missing');
  });

  it('model-missing ranks after auth', () => {
    expect(deriveRuntimeReadiness({ ...base, hasModel: false }).blockReason).toBe('model-missing');
    // auth wins over model when both fail
    expect(deriveRuntimeReadiness({ ...base, hasApiKey: false, hasModel: false }).blockReason).toBe('auth-missing');
  });

  it('test-failed is the last precondition and only when explicitly false', () => {
    expect(deriveRuntimeReadiness({ ...base, lastTestOk: false }).blockReason).toBe('test-failed');
    // never tested (null) does not block
    expect(deriveRuntimeReadiness({ ...base, lastTestOk: null }).ready).toBe(true);
  });

  it('an unknown auth mode never counts as authenticated', () => {
    const r = deriveRuntimeReadiness({ ...base, authMode: null });
    expect(r.authReady).toBe(false);
    expect(r.blockReason).toBe('auth-missing');
  });
});

describe('runtimeBlockMessage', () => {
  it('gives a distinct actionable message per reason', () => {
    const reasons = ['not-installed', 'not-configured', 'auth-missing', 'model-missing', 'test-failed'] as const;
    const msgs = reasons.map((r) => runtimeBlockMessage(r, 'apiKey'));
    expect(new Set(msgs).size).toBe(reasons.length);
    for (const m of msgs) expect(m.length).toBeGreaterThan(0);
  });

  it('auth-missing wording depends on the auth mode', () => {
    expect(runtimeBlockMessage('auth-missing', 'login')).toContain('OAuth');
    expect(runtimeBlockMessage('auth-missing', 'apiKey')).toContain('Clé API');
  });
});
