import { describe, it, expect } from 'vitest';
import { RUNTIME_PROVIDERS, getRuntimeProvider } from './runtime-providers';

describe('RUNTIME_PROVIDERS', () => {
  it('every provider has a valid authMode and the matching auth field', () => {
    for (const p of RUNTIME_PROVIDERS) {
      expect(['apiKey', 'login']).toContain(p.authMode);
      if (p.authMode === 'apiKey') {
        expect(p.keyEnvVar).toBeTruthy();
        expect(p.loginCommand).toBeUndefined();
      } else {
        expect(p.loginCommand).toBeTruthy();
        expect(p.keyEnvVar).toBeUndefined();
      }
      expect(p.providerKey).toBeTruthy();
    }
  });
  it('ids are unique', () => {
    const ids = RUNTIME_PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('getRuntimeProvider finds by id and returns undefined otherwise', () => {
    expect(getRuntimeProvider('openrouter')?.authMode).toBe('apiKey');
    expect(getRuntimeProvider('openai-codex')?.authMode).toBe('login');
    expect(getRuntimeProvider('nope')).toBeUndefined();
  });
});
