import { describe, it, expect } from 'vitest';
import { deriveAgentKpis, type AgentKpiRaw } from './kpis';

const raw = (o: Partial<AgentKpiRaw> = {}): AgentKpiRaw => ({
  executed: 0, autoApproved: 0, pending: 0, rejected: 0, failed: 0,
  runsTotal: 0, runsSucceeded: 0, runsFailed: 0, runsSkipped: 0, runsKilled: 0,
  runLatenciesMs: [], breakerTrips: 0, tasksResolved: 0, ...o,
});

describe('deriveAgentKpis', () => {
  it('totals actions and computes bounded ratios', () => {
    const k = deriveAgentKpis(raw({ executed: 8, autoApproved: 5, pending: 1, rejected: 2, failed: 2 }));
    expect(k.actions.total).toBe(13); // 8+1+2+2
    expect(k.approvalRate).toBeCloseTo(8 / 10);
    expect(k.autoApprovalRate).toBeCloseTo(5 / 8);
    expect(k.errorRate).toBeCloseTo(2 / 10);
  });
  it('zero-guards: no decisions/runs → 0 rates and null latency', () => {
    const k = deriveAgentKpis(raw());
    expect(k.approvalRate).toBe(0);
    expect(k.autoApprovalRate).toBe(0);
    expect(k.errorRate).toBe(0);
    expect(k.avgRunLatencyMs).toBeNull();
  });
  it('averages run latencies when present', () => {
    const k = deriveAgentKpis(raw({ runLatenciesMs: [100, 300] }));
    expect(k.avgRunLatencyMs).toBe(200);
  });
  it('passes through run buckets, breakerTrips, tasksResolved', () => {
    const k = deriveAgentKpis(raw({ runsTotal: 5, runsSucceeded: 3, runsFailed: 1, runsSkipped: 1, breakerTrips: 2, tasksResolved: 4 }));
    expect(k.runs).toEqual({ total: 5, succeeded: 3, failed: 1, skipped: 1, killed: 0 });
    expect(k.breakerTrips).toBe(2);
    expect(k.tasksResolved).toBe(4);
  });
});
