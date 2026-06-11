/**
 * Time windows [early, late?]. Stored in UTC; the SEMANTIC of a bound is the local
 * time of the site involved (Location.timezone) — see the phase 7.2 spec, timezone §.
 */
export interface TimeWindow {
  early: Date | null;
  late: Date | null;
}

export type WindowViolationKind = 'BEFORE_EARLY' | 'AFTER_LATE';

export interface WindowViolation {
  /** Which window pair this is about (e.g. 'pickup', 'delivery'). */
  field: string;
  kind: WindowViolationKind;
  /** The requested bound that is crossed (ISO). */
  requested: string;
  /** The planned bound that crosses it (ISO). */
  planned: string;
}

/** Hard coherence check: early ≤ late when both exist. Returns an error message or null. */
export function validateWindowPair(window: TimeWindow): string | null {
  if (window.early && window.late && window.early.getTime() > window.late.getTime()) {
    return 'Window early bound must be ≤ late bound';
  }
  return null;
}

/**
 * Advisory comparison of a PLANNED window against the REQUESTED one (never blocking:
 * the customer asked, operations decide). Open bounds constrain nothing on their side.
 * The planned early is checked against requested.early; the latest planned bound
 * (late ?? early) against requested.late.
 */
export function windowViolations(
  field: string,
  requested: TimeWindow,
  planned: TimeWindow,
): WindowViolation[] {
  const violations: WindowViolation[] = [];
  if (requested.early && planned.early && planned.early.getTime() < requested.early.getTime()) {
    violations.push({
      field,
      kind: 'BEFORE_EARLY',
      requested: requested.early.toISOString(),
      planned: planned.early.toISOString(),
    });
  }
  const plannedLatest = planned.late ?? planned.early;
  if (requested.late && plannedLatest && plannedLatest.getTime() > requested.late.getTime()) {
    violations.push({
      field,
      kind: 'AFTER_LATE',
      requested: requested.late.toISOString(),
      planned: plannedLatest.toISOString(),
    });
  }
  return violations;
}
