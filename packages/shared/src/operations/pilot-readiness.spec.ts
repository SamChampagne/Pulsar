import { describe, it, expect } from 'vitest';
import { derivePilotReadiness } from './pilot-readiness';
import type { PlatformOperations } from './control-center';
const data: PlatformOperations = {
  checkedAt: '2026-09-27T12:00:00.000Z',
  environment: {
    name: 'recette',
    version: 'a'.repeat(40),
    uptimeSeconds: 10,
    deployment: 'API mono-instance',
  },
  deploymentChecks: {
    platformMfaEnforced: true,
    migrations: {
      state: 'MATCHED',
      expected: 137,
      applied: 137,
      pending: 0,
      failed: 0,
      changed: 0,
      unexpected: 0,
    },
  },
  services: ['api', 'postgres', 'email', 'aps', 'agents'].map((key) => ({
    key,
    label: key,
    state: 'OPERATIONAL',
    detail: 'Sonde disponible',
    nextAction: 'Vérifier',
    checkedAt: '2026-09-27T12:00:00.000Z',
  })),
  queues: [],
  queuesAvailable: true,
  tenants: null,
  limits: [],
};
describe('Pilot preflight, never production certification', () => {
  it('never declares acceptance complete even with healthy services', () => {
    const r = derivePilotReadiness(data, 'SERVICES');
    expect(r.status).toBe('ACCEPTANCE_REQUIRED');
    expect(
      r.checks.filter((c) => c.kind === 'ACCEPTANCE').every((c) => c.state === 'TO_VERIFY'),
    ).toBe(true);
    expect(r.checks.find((c) => c.key === 'restore')?.detail).toContain('pas une preuve');
    expect(r.environment).not.toHaveProperty('uptimeSeconds');
  });
  it('treats missing deployment metadata as unknown, never zero migrations', () => {
    const r = derivePilotReadiness(
      { ...data, deploymentChecks: undefined, services: [] },
      'SERVICES',
    );
    expect(
      r.checks.filter((c) => c.kind === 'TECHNICAL').every((c) => c.state !== 'OBSERVED'),
    ).toBe(false); // declared SHA only
    expect(r.checks.find((c) => c.key === 'migrations')?.state).toBe('TO_VERIFY');
    expect(r.checks.find((c) => c.key === 'mfa')?.state).toBe('TO_VERIFY');
    expect(r.checks.find((c) => c.key === 'postgres')?.state).toBe('TO_VERIFY');
  });
  it('blocks drift and unenforced platform MFA', () => {
    const r = derivePilotReadiness(
      {
        ...data,
        deploymentChecks: {
          platformMfaEnforced: false,
          migrations: { ...data.deploymentChecks!.migrations, state: 'DRIFT', pending: 1 },
        },
      },
      'SERVICES',
    );
    expect(r.status).toBe('BLOCKED');
    expect(r.counts.blocked).toBe(2);
  });
  it('requires APS only for manufacturing and agents only when explicitly included', () => {
    const absent = {
      ...data,
      services: data.services.map((s) =>
        s.key === 'aps' || s.key === 'agents' ? { ...s, state: 'NOT_CONFIGURED' as const } : s,
      ),
    };
    expect(derivePilotReadiness(absent, 'SERVICES').status).toBe('ACCEPTANCE_REQUIRED');
    expect(derivePilotReadiness(absent, 'TRANSPORT').checks.some((c) => c.key === 'scanners')).toBe(
      true,
    );
    expect(derivePilotReadiness(absent, 'MANUFACTURING').counts.blocked).toBe(1);
    expect(derivePilotReadiness(absent, 'MANUFACTURING', true).counts.blocked).toBe(2);
  });
  it('does not equate configured SMTP with delivery or an installed runtime with a qualified mission', () => {
    const r = derivePilotReadiness(
      {
        ...data,
        services: data.services.map((s) =>
          s.key === 'email' || s.key === 'agents' ? { ...s, state: 'UNVERIFIED' as const } : s,
        ),
      },
      'SERVICES',
      true,
    );
    for (const key of ['email', 'email-delivery', 'agents', 'agent-mission'])
      expect(r.checks.find((c) => c.key === key)?.state).toBe('TO_VERIFY');
  });
  it('does not mutate the observation or export tenant counts or queue details', () => {
    const before = JSON.stringify(data);
    const r = derivePilotReadiness(data, 'SERVICES');
    expect(JSON.stringify(data)).toBe(before);
    expect(r).not.toHaveProperty('tenants');
    expect(r).not.toHaveProperty('queues');
    expect(r.checkedAt).toBe(data.checkedAt);
  });
});
