import { describe, expect, it } from 'vitest';
import {
  computeAgentAttention,
  rankAgentForOperations,
  summarizeAgentOperationMode,
} from './operations';

describe('agent operations helpers', () => {
  it('marks breaker-tripped agents as the highest attention item', () => {
    const attention = computeAgentAttention({
      status: 'ACTIVE',
      autonomyLevel: 'AUTONOMOUS',
      breakerTrippedAt: '2026-06-15T12:00:00.000Z',
      kpis: {
        actions: { total: 12, pending: 0 },
        errorRate: 0.02,
        breakerTrips: 1,
      },
    });

    expect(attention.severity).toBe('critical');
    expect(attention.reason).toContain('Circuit breaker');
    expect(attention.nextStep).toContain('Réarmer');
    expect(rankAgentForOperations(attention)).toBeGreaterThan(900);
  });

  it('prioritizes approval backlog before soft error-rate warnings', () => {
    const attention = computeAgentAttention({
      status: 'ACTIVE',
      autonomyLevel: 'PROPOSE',
      kpis: {
        actions: { total: 20, pending: 3 },
        errorRate: 0.18,
        breakerTrips: 0,
      },
    });

    expect(attention.severity).toBe('warning');
    expect(attention.reason).toContain('3 approbations');
    expect(attention.nextStep).toContain('file');
  });

  it('summarizes governance mode from status, autonomy and caps', () => {
    expect(
      summarizeAgentOperationMode({
        status: 'ACTIVE',
        autonomyLevel: 'ACT_LOW',
        caps: { maxAmountPerAction: 2500, maxActionsPerMinute: 4 },
      }),
    ).toEqual('ACT_LOW · cap 2500$/action · 4/min');

    expect(
      summarizeAgentOperationMode({
        status: 'PAUSED',
        autonomyLevel: 'AUTONOMOUS',
        caps: {},
      }),
    ).toEqual('PAUSED · AUTONOMOUS');
  });
});
