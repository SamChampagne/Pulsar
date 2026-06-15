// Pure, browser-safe. No node:* imports.

export interface AgentKpiRaw {
  executed: number;
  autoApproved: number;
  pending: number;
  rejected: number;
  failed: number;
  runsTotal: number;
  runsSucceeded: number;
  runsFailed: number;
  runsSkipped: number;
  runsKilled: number;
  runLatenciesMs: number[];
  breakerTrips: number;
  tasksResolved: number;
}

export interface AgentKpis {
  actions: { total: number; executed: number; autoApproved: number; pending: number; rejected: number; failed: number };
  approvalRate: number;
  autoApprovalRate: number;
  errorRate: number;
  runs: { total: number; succeeded: number; failed: number; skipped: number; killed: number };
  avgRunLatencyMs: number | null;
  breakerTrips: number;
  tasksResolved: number;
}

const ratio = (num: number, den: number): number => (den > 0 ? num / den : 0);

/** Shape raw counts into bounded KPI ratios. Pure. */
export function deriveAgentKpis(raw: AgentKpiRaw): AgentKpis {
  const avgRunLatencyMs =
    raw.runLatenciesMs.length > 0
      ? Math.round(raw.runLatenciesMs.reduce((a, b) => a + b, 0) / raw.runLatenciesMs.length)
      : null;
  return {
    actions: {
      total: raw.executed + raw.pending + raw.rejected + raw.failed,
      executed: raw.executed,
      autoApproved: raw.autoApproved,
      pending: raw.pending,
      rejected: raw.rejected,
      failed: raw.failed,
    },
    approvalRate: ratio(raw.executed, raw.executed + raw.rejected),
    autoApprovalRate: ratio(raw.autoApproved, raw.executed),
    errorRate: ratio(raw.failed, raw.executed + raw.failed),
    runs: {
      total: raw.runsTotal,
      succeeded: raw.runsSucceeded,
      failed: raw.runsFailed,
      skipped: raw.runsSkipped,
      killed: raw.runsKilled,
    },
    avgRunLatencyMs,
    breakerTrips: raw.breakerTrips,
    tasksResolved: raw.tasksResolved,
  };
}
