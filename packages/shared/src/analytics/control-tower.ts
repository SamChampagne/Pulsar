/**
 * Pure types and math for the Control Tower operational dashboard.
 * Consumed by the API service and the web page — no side effects, no imports outside this file.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AttentionSeverity = 'critical' | 'warning' | 'info';

export type AttentionKind =
  | 'load_late'
  | 'freight_dispute'
  | 'asset_out_of_service'
  | 'dock_at_risk'
  | 'pick_ready_not_dispatched'
  | 'agent_action_pending';

export interface AttentionItem {
  kind: AttentionKind;
  severity: AttentionSeverity;
  label: string;
  /** Entity id */
  ref?: string;
  /** Web deep-link */
  href?: string;
  /** ISO timestamp, used for sorting */
  at?: string;
}

export interface ControlTowerKpis {
  loadsInTransit: number;
  loadsLate: number;
  otifPct: number | null;
  avgCostPerLoad: number | null;
  recoveredAmount: number;
  disputesOpen: number;
  fleetAvailabilityPct: number | null;
  agentActionsPending: number;
  tasksOpen: number;
}

export interface ControlTower {
  rangeDays: number;
  kpis: ControlTowerKpis;
  attention: AttentionItem[];
}

// ---------------------------------------------------------------------------
// Pure math helpers
// ---------------------------------------------------------------------------

/**
 * OTIF = on-time deliveries / total deliveries, as a percentage rounded to 1 decimal.
 * Returns null when the denominator is 0.
 */
export function computeOtif(rows: { onTime: boolean }[]): number | null {
  if (rows.length === 0) return null;
  const onTimeCount = rows.filter((r) => r.onTime).length;
  return Math.round((onTimeCount / rows.length) * 1000) / 10;
}

/**
 * Fleet availability = available assets / total assets (excluding RETIRED), as a percentage
 * rounded to 1 decimal. Returns null when total is 0.
 */
export function computeFleetAvailability(c: { available: number; total: number }): number | null {
  if (c.total === 0) return null;
  return Math.round((c.available / c.total) * 1000) / 10;
}

/**
 * Arithmetic mean of an array of numbers.
 * Returns null for an empty array.
 */
export function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// Severity rank — lower number = higher priority (sorts first).
const SEVERITY_RANK: Record<AttentionSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

/**
 * Sorts attention items:
 *   1. By severity descending priority: critical → warning → info
 *   2. Within the same severity, by `at` descending (newest first).
 *   3. Items without `at` fall after dated items within their severity group.
 *
 * Pure — does not mutate the input array.
 */
export function sortAttention(items: AttentionItem[]): AttentionItem[] {
  return [...items].sort((a, b) => {
    const severityDiff = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (severityDiff !== 0) return severityDiff;

    // Same severity: sort by `at` descending; undefined → last.
    if (a.at === undefined && b.at === undefined) return 0;
    if (a.at === undefined) return 1;
    if (b.at === undefined) return -1;
    // Lexicographic comparison works for ISO 8601 strings.
    return b.at.localeCompare(a.at);
  });
}
