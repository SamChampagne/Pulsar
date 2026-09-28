import { beforeEach, describe, expect, it } from 'vitest';
import { readPlanningIntent, rememberPlanningIntent } from './planning-intent';
describe('planning request persistence', () => {
  beforeEach(() => localStorage.clear());
  const p = {
    path: '/billing/budgets',
    method: 'POST' as const,
    body: {
      operationKey: '12345678-1234-4123-8123-123456789012',
      currency: 'CAD',
      name: 'Test',
      isActive: true,
      fiscalYear: 2026,
      periodFrom: '2026-01-01',
      periodTo: '2026-12-31',
      lines: [{ accountCode: '4000', amount: '0.30' }],
    },
  };
  it('retains exact body and refuses overwriting an uncertain request', () => {
    rememberPlanningIntent('tenant:user', p);
    expect(readPlanningIntent('tenant:user')).toEqual(p);
    expect(() =>
      rememberPlanningIntent('tenant:user', { ...p, body: { ...p.body, currency: 'USD' } }),
    ).toThrow();
    expect(readPlanningIntent('other:user')).toBeNull();
  });
  it('blocks corrupted storage and arbitrary request paths', () => {
    for (const raw of [
      '{',
      JSON.stringify({ ...p, path: '/users' }),
      JSON.stringify({ ...p, method: 'DELETE' }),
      JSON.stringify({ ...p, body: { ...p.body, lines: null } }),
      JSON.stringify({ ...p, body: { ...p.body, periodFrom: '2026-02-30' } }),
    ]) {
      localStorage.setItem('k', raw);
      expect(() => readPlanningIntent('k')).toThrow();
    }
  });
});
