import { buildRuntimeEnv, renderCliConfig } from './agent-runtime-env';

const base = {
  tenantId: 't1',
  provider: 'openrouter',
  authMode: 'apiKey',
  defaultModel: 'anthropic/claude-opus-4.6',
  baseUrl: null,
};

describe('buildRuntimeEnv', () => {
  it('apiKey provider sets the key env var + HERMES_HOME', () => {
    const { env, homeDir } = buildRuntimeEnv(base, 'sk-secret', '/data/hermes');
    expect(env.OPENROUTER_API_KEY).toBe('sk-secret');
    expect(env.HERMES_HOME).toBe(homeDir);
    expect(homeDir.replace(/\\/g, '/')).toContain('/data/hermes/t1');
  });
  it('login provider sets only HERMES_HOME (no key env)', () => {
    const { env } = buildRuntimeEnv(
      { ...base, provider: 'openai-codex', authMode: 'login' },
      null,
      '/data/hermes',
    );
    expect(env.HERMES_HOME).toBeTruthy();
    expect(env.OPENROUTER_API_KEY).toBeUndefined();
  });
});

describe('renderCliConfig', () => {
  it('emits the Hermes provider key + default model', () => {
    const yaml = renderCliConfig(base);
    expect(yaml).toContain('openrouter'); // model.provider
    expect(yaml).toContain('anthropic/claude-opus-4.6'); // model.default
  });
  it('escapes quotes and backslashes in interpolated values', () => {
    const yaml = renderCliConfig({ tenantId: 't1', provider: 'openrouter', authMode: 'apiKey', defaultModel: 'we"ird\\model', baseUrl: null });
    expect(yaml).toContain('\\"');   // escaped quote present
    expect(yaml).not.toContain('"we"ird'); // no raw unescaped quote breaking the scalar
  });
});
