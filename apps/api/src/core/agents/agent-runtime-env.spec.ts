import { buildRuntimeEnv, isolatedRuntimeEnv, renderCliConfig } from './agent-runtime-env';

const base = {
  tenantId: 't1',
  provider: 'openrouter',
  authMode: 'apiKey',
  defaultModel: 'anthropic/claude-opus-4.6',
  baseUrl: null,
};

describe('buildRuntimeEnv', () => {
  it('passes only OS plumbing and this tenant key, never API or personal credentials', () => {
    const tenant = buildRuntimeEnv(base, 'tenant-key', '/data/hermes').env;
    const result = isolatedRuntimeEnv(tenant, {
      Path: '/bin',
      SystemRoot: 'C:\\Windows',
      DATABASE_URL: 'secret',
      JWT_SECRET: 'secret',
      SMTP_PASSWORD: 'secret',
      OPENROUTER_API_KEY: 'platform-key',
      ANTHROPIC_API_KEY: 'other-key',
      GH_TOKEN: 'personal',
      USERPROFILE: '/operator',
      PYTHONPATH: '/untrusted',
      HERMES_KANBAN_TASK: '1',
    });
    expect(result.Path).toBe('/bin');
    expect(result.SystemRoot).toBe('C:\\Windows');
    expect(result.OPENROUTER_API_KEY).toBe('tenant-key');
    expect(result.USERPROFILE).toBe(tenant.HERMES_HOME);
    for (const key of [
      'DATABASE_URL',
      'JWT_SECRET',
      'SMTP_PASSWORD',
      'ANTHROPIC_API_KEY',
      'GH_TOKEN',
      'PYTHONPATH',
      'HERMES_KANBAN_TASK',
    ]) {
      expect(result[key]).toBeUndefined();
    }
  });
  it('does not inherit any provider credential for an OAuth tenant', () => {
    const tenant = buildRuntimeEnv(
      { ...base, provider: 'nous', authMode: 'login' },
      null,
      '/data/hermes',
    ).env;
    expect(
      isolatedRuntimeEnv(tenant, { OPENAI_API_KEY: 'platform' }).OPENAI_API_KEY,
    ).toBeUndefined();
  });
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
    const yaml = renderCliConfig({
      tenantId: 't1',
      provider: 'openrouter',
      authMode: 'apiKey',
      defaultModel: 'we"ird\\model',
      baseUrl: null,
    });
    expect(yaml).toContain('\\"'); // escaped quote present
    expect(yaml).not.toContain('"we"ird'); // no raw unescaped quote breaking the scalar
  });
  it('strips a leading "<provider>:" prefix from model.default (would 404 raw)', () => {
    const yaml = renderCliConfig({
      tenantId: 't1',
      provider: 'anthropic',
      authMode: 'apiKey',
      defaultModel: 'anthropic:claude-sonnet-4-6',
      baseUrl: null,
    });
    expect(yaml).toContain('default: "claude-sonnet-4-6"');
    expect(yaml).not.toContain('anthropic:claude-sonnet-4-6');
  });
  it('strips newlines to prevent YAML injection', () => {
    const yaml = renderCliConfig({
      tenantId: 't1',
      provider: 'custom',
      authMode: 'apiKey',
      defaultModel: 'm',
      baseUrl: 'http://x\nmodel:\n  default: "evil"',
    });
    expect(yaml).not.toMatch(/\n\s*default:\s*"evil"/);
  });
});
