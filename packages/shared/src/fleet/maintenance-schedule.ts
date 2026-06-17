/**
 * Preventive-maintenance scheduling (pure, no Node imports).
 *
 * A schedule has an interval on one or two axes — calendar days and/or odometer
 * km — anchored at the last service. The due status is COMPUTED from the anchor +
 * interval (never persisted, like compliance). Completing a linked work order
 * advances the anchor, which is what gives the module its continuity: the clock
 * re-arms and the next cycle is recomputed forward.
 */

export enum MaintenanceScheduleStatus {
  OK = 'OK',
  DUE_SOON = 'DUE_SOON',
  DUE = 'DUE',
  OVERDUE = 'OVERDUE',
}

export interface ScheduleInput {
  intervalDays?: number | null;
  intervalKm?: number | null;
  /** Last service date — anchor for the calendar axis. */
  anchorDate: Date | string;
  /** Last service odometer — anchor for the km axis. */
  anchorOdometerKm?: number | null;
  /** Days before the due date at which we start warning (DUE_SOON). */
  leadDays?: number | null;
}

export interface ScheduleDue {
  status: MaintenanceScheduleStatus;
  nextDueDate: string | null;
  nextDueKm: number | null;
  daysUntilDue: number | null;
  kmUntilDue: number | null;
  /** True for DUE or OVERDUE — the schedule warrants a work order now. */
  isDue: boolean;
}

const DAY_MS = 86_400_000;
const RANK: Record<MaintenanceScheduleStatus, number> = {
  [MaintenanceScheduleStatus.OK]: 0,
  [MaintenanceScheduleStatus.DUE_SOON]: 1,
  [MaintenanceScheduleStatus.DUE]: 2,
  [MaintenanceScheduleStatus.OVERDUE]: 3,
};

/** remaining > lead → OK; within lead → DUE_SOON; <= 0 → DUE; below -lead → OVERDUE. */
function axisStatus(remaining: number, lead: number): MaintenanceScheduleStatus {
  if (remaining > lead) return MaintenanceScheduleStatus.OK;
  if (remaining > 0) return MaintenanceScheduleStatus.DUE_SOON;
  if (remaining >= -lead) return MaintenanceScheduleStatus.DUE;
  return MaintenanceScheduleStatus.OVERDUE;
}

const worse = (a: MaintenanceScheduleStatus, b: MaintenanceScheduleStatus) =>
  RANK[a] >= RANK[b] ? a : b;

export function computeScheduleDue(
  schedule: ScheduleInput,
  now: Date = new Date(),
  currentOdometerKm?: number | null,
): ScheduleDue {
  const leadDays = schedule.leadDays ?? 7;
  let status = MaintenanceScheduleStatus.OK;
  let nextDueDate: string | null = null;
  let nextDueKm: number | null = null;
  let daysUntilDue: number | null = null;
  let kmUntilDue: number | null = null;
  let evaluated = false;

  // Calendar axis.
  if (schedule.intervalDays && schedule.intervalDays > 0) {
    const anchor = new Date(schedule.anchorDate);
    const due = new Date(anchor.getTime() + schedule.intervalDays * DAY_MS);
    nextDueDate = due.toISOString();
    daysUntilDue = Math.ceil((due.getTime() - now.getTime()) / DAY_MS);
    status = worse(status, axisStatus(daysUntilDue, leadDays));
    evaluated = true;
  }

  // Odometer axis — only when we have both anchor and a current reading.
  if (
    schedule.intervalKm &&
    schedule.intervalKm > 0 &&
    schedule.anchorOdometerKm != null &&
    currentOdometerKm != null
  ) {
    nextDueKm = schedule.anchorOdometerKm + schedule.intervalKm;
    kmUntilDue = nextDueKm - currentOdometerKm;
    const kmLead = Math.max(1, Math.round(schedule.intervalKm * 0.1));
    status = worse(status, axisStatus(kmUntilDue, kmLead));
    evaluated = true;
  }

  // No usable interval → treat as OK (nothing to schedule).
  if (!evaluated) status = MaintenanceScheduleStatus.OK;

  return {
    status,
    nextDueDate,
    nextDueKm,
    daysUntilDue,
    kmUntilDue,
    isDue: status === MaintenanceScheduleStatus.DUE || status === MaintenanceScheduleStatus.OVERDUE,
  };
}
